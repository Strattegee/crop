import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { genderRequestWords, requestArrivedEmail } from '../src/agencies/requests.js';
import { startFakeIdp } from './fake-idp.js';

describe('gender requested, carried to agencies (migration 0049)', () => {
  it('words the request for the agency', () => {
    expect(genderRequestWords('F')).toBe('A female worker requested');
    expect(genderRequestWords('M')).toBe('A male worker requested');
    expect(genderRequestWords(null)).toBeNull();
    const shift = { employerName: 'Bayside', siteName: 'Campus', siteTimezone: 'Australia/Melbourne', areaName: null, role: 'Carer',
      startsAt: new Date('2026-11-03T22:00:00Z'), endsAt: new Date('2026-11-04T06:00:00Z'), duties: [], requirements: [], note: null };
    expect(requestArrivedEmail({ ...shift, genderRequested: 'F' }, null).body).toContain('A female worker requested');
    expect(requestArrivedEmail(shift, null).body).not.toContain('worker requested');
  });
});

describe('agency fill with a gender requested', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const people: Record<string, string> = {};
  let site: string;
  let shift: string;
  let inboxId: string;

  type Person = { workerId: string; eligible: boolean; warnings: Array<{ code: string; message: string }> };
  const peopleList = async () => ((await http().get(`/agency-requests/${inboxId}/people`).set(as('ag')).expect(200)).body as { people: Person[] }).people;

  beforeAll(async () => {
    db = await createTestDatabase('crop_agency_gender');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(
      `insert into tenants(slug, name) values ('bayside','Bayside Care'),('cfy','Caring For You'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'emp@x.com','owner'),($2,'ag@x.com','admin'),($3,'nosy@x.com','owner')`,
      [ids.bayside, ids.cfy, ids.nosy]);
    for (const [sub, email] of [['emp', 'emp@x.com'], ['ag', 'ag@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    site = (await owner.query<{ id: string }>(`insert into facilities(tenant_id, name, timezone) values ($1, 'Bayside Campus', 'Australia/Melbourne') returning id`, [ids.bayside])).rows[0].id;
    const conn = (await owner.query<{ id: string }>('select gen_random_uuid() as id')).rows[0].id;
    await owner.query(
      `insert into agency_connections(tenant_id, connection_id, side, other_tenant_id, other_name, status, preference) values
         ($1,$3,'employer',$2,'Caring For You','active',1), ($2,$3,'agency',$1,'Bayside Care','active',null)`, [ids.bayside, ids.cfy, conn]);
    // The agency's people: Ana (F), Ben (M), Cal (not recorded).
    for (const [first, g] of [['Ana', 'F'], ['Ben', 'M'], ['Cal', null]] as const) {
      const w = (await owner.query<{ id: string }>(
        `insert into workers(tenant_id, first_name, last_name, roles, email, gender) values ($1,$2,'Example','{Carer}',$3,$4) returning id`,
        [ids.cfy, first, `${first.toLowerCase()}@example.com`, g])).rows[0].id;
      people[first] = w;
      await owner.query(`insert into right_to_work_records(tenant_id, worker_id, status, citizen_proof_type, verification) values ($1,$2,'citizen','au_passport','verified')`, [ids.cfy, w]);
    }
    shift = (await owner.query<{ id: string }>(
      `insert into shifts(tenant_id, facility_id, role, starts_at, ends_at, gender_requested)
       values ($1, $2, 'Carer', now() + interval '30 hours', now() + interval '38 hours', 'F') returning id`, [ids.bayside, site])).rows[0].id;
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    delete process.env.APP_URL;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    // Everyone signs in once, so their memberships exist.
    for (const who of ['emp', 'ag', 'nosy']) await http().get('/me').set(as(who)).expect(200);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it("the agency's copy says a female worker was requested, and its email says so", async () => {
    await http().post(`/shifts/${shift}/agency-fill`).set(as('emp')).send({}).expect(201);
    const list = (await http().get('/agency-requests').set(as('ag')).expect(200)).body as Array<{ id: string; genderRequested: string | null }>;
    expect(list).toHaveLength(1);
    expect(list[0].genderRequested).toBe('F');
    inboxId = list[0].id;
    expect((await http().get(`/agency-requests/${inboxId}`).set(as('ag')).expect(200)).body.genderRequested).toBe('F');
    const mail = (await owner.query<{ tenant_id: string; body: string }>(`select tenant_id, body from notifications where template = 'agency_request'`)).rows;
    expect(mail.length).toBeGreaterThan(0);
    expect(mail.every(m => m.tenant_id === ids.cfy && m.body.includes('A female worker requested'))).toBe(true);
    // Another business sees nothing.
    expect((await http().get('/agency-requests').set(as('nosy')).expect(200)).body).toEqual([]);
  });

  it("warns about the agency's people of another or unrecorded gender, never blocks", async () => {
    const list = await peopleList();
    const byId = new Map(list.map(p => [p.workerId, p]));
    expect(byId.get(people.Ana)!.warnings.some(w => w.code === 'gender')).toBe(false);
    expect(byId.get(people.Ben)!.warnings.find(w => w.code === 'gender')?.message).toMatch(/female/);
    expect(byId.get(people.Cal)!.warnings.find(w => w.code === 'gender')?.message).toMatch(/isn't recorded/);
    expect(list.every(p => p.eligible)).toBe(true);
  });

  it("follows the employer's change while the request is open", async () => {
    await http().put(`/shifts/${shift}/gender`).set(as('emp')).send({ genderRequested: 'M' }).expect(200);
    expect((await http().get(`/agency-requests/${inboxId}`).set(as('ag')).expect(200)).body.genderRequested).toBe('M');
    const byId = new Map((await peopleList()).map(p => [p.workerId, p]));
    expect(byId.get(people.Ben)!.warnings.some(w => w.code === 'gender')).toBe(false);
    expect(byId.get(people.Ana)!.warnings.some(w => w.code === 'gender')).toBe(true);
    await http().put(`/shifts/${shift}/gender`).set(as('emp')).send({ genderRequested: null }).expect(200);
    expect((await http().get(`/agency-requests/${inboxId}`).set(as('ag')).expect(200)).body.genderRequested).toBeNull();
  });

  it('crop_app still cannot write the agency copy itself', async () => {
    const app_ = new Client({ connectionString: db.appUrl });
    await app_.connect();
    try {
      await expect(app_.query(`update agency_inbox set gender_requested = 'F'`)).rejects.toThrow(/permission denied/);
    } finally {
      await app_.end();
    }
  });
});
