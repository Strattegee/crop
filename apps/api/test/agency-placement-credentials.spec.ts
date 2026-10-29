import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { startFakeIdp } from './fake-idp.js';

describe('agency people count for cover rules and equipment operators', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const people: Record<string, string> = {};
  let conn: string;
  let site: string;
  let forklift: string;

  const newShift = async (hoursAhead: number, length = 8) =>
    (await owner.query<{ id: string }>(
      `insert into shifts(tenant_id, facility_id, role, starts_at, ends_at)
       values ($1, $2, 'Nurse', now() + make_interval(hours => $3), now() + make_interval(hours => $3 + $4)) returning id`,
      [ids.bayside, site, hoursAhead, length])).rows[0].id;
  const localDate = async (shift: string) => (await owner.query<{ d: string }>(
    `select to_char(starts_at at time zone 'Australia/Melbourne', 'YYYY-MM-DD') as d from shifts where id = $1`, [shift])).rows[0].d;
  /** Sends the shift to agencies, then the agency puts the person forward. */
  const putForward = async (shift: string, person: string) => {
    await http().post(`/shifts/${shift}/agency-fill`).set(as('emp')).send({}).expect(201);
    const s = (await owner.query<{ starts_at: Date }>('select starts_at from shifts where id = $1', [shift])).rows[0];
    const list = (await http().get('/agency-requests').set(as('ag')).expect(200)).body as Array<{ id: string; startsAt: string }>;
    const inboxId = list.find(r => new Date(r.startsAt).getTime() === s.starts_at.getTime())!.id;
    await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('ag')).send({ workerId: person }).expect(200);
  };
  const gapsOn = async (shift: string) => {
    const d = await localDate(shift);
    return ((await http().get(`/roster/cover-gaps?from=${d}&to=${d}`).set(as('emp')).expect(200)).body as Array<{ shiftIds: string[] }>)
      .filter(g => g.shiftIds.includes(shift));
  };

  beforeAll(async () => {
    db = await createTestDatabase('crop_agency_placement_creds');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(
      `insert into tenants(slug, name) values ('bayside','Bayside Hospital'),('cfy','Caring For You'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'emp@x.com','owner'),($2,'ag@x.com','admin'),($3,'nosy@x.com','owner')`,
      [ids.bayside, ids.cfy, ids.nosy]);
    for (const [sub, email] of [['emp', 'emp@x.com'], ['ag', 'ag@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    site = (await owner.query<{ id: string }>(`insert into facilities(tenant_id, name, timezone) values ($1, 'Bayside Campus', 'Australia/Melbourne') returning id`, [ids.bayside])).rows[0].id;
    const type = async (tenant: string, name: string) =>
      (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category) values ($1, $2, 'registration') returning id`, [tenant, name])).rows[0].id;
    // The employer: nurses must be registered; someone with first aid on at all times; forklifts need a licence.
    ids.reg = await type(ids.bayside, 'Nursing registration');
    ids.firstAid = await type(ids.bayside, 'First aid');
    ids.licence = await type(ids.bayside, 'Forklift licence');
    await owner.query(`insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity) values ($1,$2,'role','Nurse','hard')`, [ids.bayside, ids.reg]);
    await owner.query(`insert into site_cover_rules(tenant_id, facility_id, credential_type_id) values ($1,$2,$3)`, [ids.bayside, site, ids.firstAid]);
    const et = (await owner.query<{ id: string }>(`insert into equipment_types(tenant_id, name, operator_credential_type_id) values ($1,'Forklift',$2) returning id`, [ids.bayside, ids.licence])).rows[0].id;
    forklift = (await owner.query<{ id: string }>(`insert into equipment(tenant_id, equipment_type_id, name) values ($1,$2,'Forklift 1') returning id`, [ids.bayside, et])).rows[0].id;

    conn = (await owner.query<{ id: string }>('select gen_random_uuid() as id')).rows[0].id;
    await owner.query(
      `insert into agency_connections(tenant_id, connection_id, side, other_tenant_id, other_name, status, preference) values
         ($1,$3,'employer',$2,'Caring For You','active',1), ($2,$3,'agency',$1,'Bayside Hospital','active',null)`, [ids.bayside, ids.cfy, conn]);
    // The agency's own credential types; the registration is matched already.
    ids.ownReg = await type(ids.cfy, 'AHPRA registration');
    ids.ownFirstAid = await type(ids.cfy, 'Provide first aid');
    ids.ownLicence = await type(ids.cfy, 'LF licence');
    await owner.query(
      `insert into agency_credential_maps(tenant_id, connection_id, employer_credential_type_id, employer_type_name, credential_type_id, matched_by) values ($1,$2,$3,'Nursing registration',$4,'hand')`,
      [ids.cfy, conn, ids.reg, ids.ownReg]);
    const day = async (n: number) => (await owner.query<{ d: string }>(`select to_char(now() + make_interval(days => $1), 'YYYY-MM-DD') as d`, [n])).rows[0].d;
    const far = await day(400);
    const soon = await day(2);
    // Ana: first aid and forklift licence, both checked. Ben: first aid not checked yet. Cara: first aid runs out in two days.
    const holds: Record<string, Array<[string, string, string]>> = {
      Ana: [[ids.ownFirstAid, far, 'verified'], [ids.ownLicence, far, 'verified']],
      Ben: [[ids.ownFirstAid, far, 'unverified']],
      Cara: [[ids.ownFirstAid, soon, 'verified']],
    };
    for (const [first, creds] of Object.entries(holds)) {
      const w = (await owner.query<{ id: string }>(
        `insert into workers(tenant_id, first_name, last_name, roles, email) values ($1,$2,'Example','{Nurse}',$3) returning id`,
        [ids.cfy, first, `${first.toLowerCase()}@example.com`])).rows[0].id;
      people[first] = w;
      await owner.query(`insert into right_to_work_records(tenant_id, worker_id, status, citizen_proof_type, verification) values ($1,$2,'citizen','au_passport','verified')`, [ids.cfy, w]);
      await owner.query(`insert into worker_credentials(tenant_id, worker_id, credential_type_id, expiry_date, verification) values ($1,$2,$3,$4,'verified')`, [ids.cfy, w, ids.ownReg, far]);
      for (const [typeId, expiry, v] of creds) {
        await owner.query(`insert into worker_credentials(tenant_id, worker_id, credential_type_id, expiry_date, verification) values ($1,$2,$3,$4,$5)`, [ids.cfy, w, typeId, expiry, v]);
      }
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    delete process.env.APP_URL;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lists cover and operator credentials for the agency to match, as optional', async () => {
    const reqs = (await http().get(`/agency-links/${conn}/requirements`).set(as('ag')).expect(200)).body;
    const list = (reqs.requirements ?? reqs) as Array<{ requirementId: string; name: string; severity: string; neededFor: string[] }>;
    expect(list.map(r => [r.name, r.severity, r.neededFor])).toEqual([
      ['Nursing registration', 'hard', ['Nurse']],
      ['First aid', 'optional', ['Cover at Bayside Campus']],
      ['Forklift licence', 'optional', ['Forklift operator']],
    ]);
    await http().put(`/agency-links/${conn}/matches`).set(as('ag')).send({ matches: [
      { requirementId: ids.firstAid, credentialTypeId: ids.ownFirstAid },
      { requirementId: ids.licence, credentialTypeId: ids.ownLicence },
    ] }).expect(200);
    // Optional ones never hold the link up, and another business sees nothing.
    const links = (await http().get('/agency-links').set(as('ag')).expect(200)).body;
    expect(JSON.stringify(links)).toContain('active');
    await http().get(`/agency-links/${conn}/requirements`).set(as('nosy')).expect(404);
  });

  it('an agency person with first aid fills the cover rule; one without leaves a gap', async () => {
    const withAna = await newShift(30);
    expect((await gapsOn(withAna))).toEqual([]);
    await putForward(withAna, people.Ana);
    expect(await gapsOn(withAna)).toEqual([]);
    const kept = (await owner.query<{ credential_type_ids: string[] }>('select credential_type_ids from agency_placements where shift_id = $1', [withAna])).rows[0];
    expect([...kept.credential_type_ids].sort()).toEqual([ids.reg, ids.firstAid, ids.licence].sort());
    const fill = (await http().get(`/shifts/${withAna}/agency-fill`).set(as('emp')).expect(200)).body;
    expect(fill.placement.confirmedCredentials).toEqual(['First aid', 'Forklift licence', 'Nursing registration']);

    // Ben's first aid isn't checked yet, so it doesn't count.
    const withBen = await newShift(80);
    await putForward(withBen, people.Ben);
    expect(await gapsOn(withBen)).toHaveLength(1);

    // Cara's runs out before the shift's date.
    const withCara = await newShift(24 * 4);
    await putForward(withCara, people.Cara);
    expect(await gapsOn(withCara)).toHaveLength(1);
    const caras = (await owner.query<{ credential_type_ids: string[] }>('select credential_type_ids from agency_placements where shift_id = $1', [withCara])).rows[0];
    expect(caras.credential_type_ids).toEqual([ids.reg]);

    // Equipment: Ana can operate the forklift; Ben can't.
    await http().post(`/shifts/${withAna}/equipment`).set(as('emp')).send({ equipmentId: forklift }).expect(200);
    const forBen = (await http().get(`/shifts/${withBen}/equipment-candidates`).set(as('emp')).expect(200)).body.candidates as Array<{ equipmentId: string; eligible: boolean; blocks: Array<{ message: string }> }>;
    const f = forBen.find(c => c.equipmentId === forklift)!;
    expect(f.eligible).toBe(false);
    expect(f.blocks.map(b => b.message).join(' ')).toMatch(/Forklift licence/);
  });
});
