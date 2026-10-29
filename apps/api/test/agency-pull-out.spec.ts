import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { AgencyEscalator } from '../src/agencies/agency-fill.controller.js';
import { placementChangedEmail, placementWords, pulledOutEmail } from '../src/agencies/requests.js';
import { startFakeIdp } from './fake-idp.js';

describe('agency pull out and placement emails: wording', () => {
  const base = {
    personName: 'Ana Example', role: 'Nurse', siteName: 'Bayside Campus', areaName: 'Ward 3',
    startsAt: new Date('2026-11-02T20:00:00Z'), endsAt: new Date('2026-11-03T04:30:00Z'), siteTimezone: 'Australia/Melbourne',
  };
  it('tells the agency what the employer did, in plain words', () => {
    expect(placementWords('pulled_out')).toBe('Pulled out');
    const approved = placementChangedEmail({ ...base, employerName: 'Bayside Hospital', placement: 'booked' }, 'https://staging.cropwms.com/');
    expect(approved.subject).toBe('Bayside Hospital approved Ana Example: Nurse on Tue 3 Nov');
    expect(approved.body).toContain('Bayside Hospital has approved Ana Example. They are booked on the shift.');
    expect(approved.body).toContain('Nurse at Ward 3, Bayside Campus');
    expect(approved.body).toContain('https://staging.cropwms.com/allocations');
    expect(placementChangedEmail({ ...base, employerName: 'Bayside Hospital', placement: 'declined' }, null).subject).toBe('Bayside Hospital declined Ana Example: Nurse on Tue 3 Nov');
    expect(placementChangedEmail({ ...base, employerName: 'Bayside Hospital', placement: 'removed' }, null).subject).toBe('Bayside Hospital took Ana Example off a shift: Nurse on Tue 3 Nov');
    const cancelled = placementChangedEmail({ ...base, employerName: 'Bayside Hospital', placement: 'cancelled' }, null);
    expect(cancelled.subject).toBe('Bayside Hospital cancelled a shift for Ana Example: Nurse on Tue 3 Nov');
    expect(cancelled.body).toContain('See it in CROP under Allocations.');
  });
  it('tells the employer the agency pulled its person out', () => {
    const e = pulledOutEmail({ ...base, agencyName: 'Caring For You', reason: 'Car broke down', shiftId: 'abc', weekStart: '2026-11-02' }, 'https://staging.cropwms.com');
    expect(e.subject).toBe('Caring For You pulled Ana Example out: Nurse on Tue 3 Nov');
    expect(e.body).toContain('Caring For You has pulled Ana Example out of your shift:');
    expect(e.body).toContain('Reason from Caring For You: Car broke down');
    expect(e.body).toContain('The shift is open again.');
    expect(e.body).toContain('https://staging.cropwms.com/roster?week=2026-11-02&shift=abc#shift-panel');
  });
});

describe('agency pull out and placement emails: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const conn: Record<string, string> = {};
  const people: Record<string, string> = {};
  let site: string;
  let timer: AgencyEscalator;

  const newShift = async (hoursAhead: number, length = 8) =>
    (await owner.query<{ id: string }>(
      `insert into shifts(tenant_id, facility_id, role, starts_at, ends_at)
       values ($1, $2, 'Nurse', now() + make_interval(hours => $3), now() + make_interval(hours => $3 + $4)) returning id`,
      [ids.bayside, site, hoursAhead, length])).rows[0].id;
  /** Sends a shift to agencies and returns the agency's copy of it (for the agency that got it first). */
  const sendToAgency = async (shift: string, who = 'ag') => {
    await http().post(`/shifts/${shift}/agency-fill`).set(as('emp')).send({}).expect(201);
    const list = (await http().get('/agency-requests').set(as(who)).expect(200)).body as Array<{ id: string; startsAt: string }>;
    const s = (await owner.query<{ starts_at: Date }>('select starts_at from shifts where id = $1', [shift])).rows[0];
    return list.find(r => new Date(r.startsAt).getTime() === s.starts_at.getTime())!.id;
  };
  const fill = async (shift: string) => (await http().get(`/shifts/${shift}/agency-fill`).set(as('emp')).expect(200)).body;

  beforeAll(async () => {
    db = await createTestDatabase('crop_agency_pull_out');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(
      `insert into tenants(slug, name) values ('bayside','Bayside Hospital'),('cfy','Caring For You'),('metro','Metro Nurses'),('nosy','Nosy Staffing')
       returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(
      `insert into invitations(tenant_id, email, role) values ($1,'emp@x.com','owner'),($2,'ag@x.com','admin'),($2,'agw@x.com','worker'),
         ($3,'metro@x.com','owner'),($4,'nosy@x.com','owner')`, [ids.bayside, ids.cfy, ids.metro, ids.nosy]);
    for (const [sub, email] of [['emp', 'emp@x.com'], ['ag', 'ag@x.com'], ['agw', 'agw@x.com'], ['metro', 'metro@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: sub === 'ag' ? 'Alex Agent' : undefined });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    site = (await owner.query<{ id: string }>(`insert into facilities(tenant_id, name, timezone) values ($1, 'Bayside Campus', 'Australia/Melbourne') returning id`, [ids.bayside])).rows[0].id;
    const reg = (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category) values ($1, 'Nursing registration', 'registration') returning id`, [ids.bayside])).rows[0].id;
    await owner.query(`insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity) values ($1,$2,'role','Nurse','hard')`, [ids.bayside, reg]);
    for (const [slug, name, pref] of [['cfy', 'Caring For You', 1], ['metro', 'Metro Nurses', 2]] as const) {
      const c = (await owner.query<{ id: string }>('select gen_random_uuid() as id')).rows[0].id;
      conn[slug] = c;
      await owner.query(
        `insert into agency_connections(tenant_id, connection_id, side, other_tenant_id, other_name, status, preference) values
           ($1,$3,'employer',$2,$4,'active',$5), ($2,$3,'agency',$1,'Bayside Hospital','active',null)`, [ids.bayside, ids[slug], c, name, pref]);
      const own = (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category) values ($1, 'AHPRA registration', 'registration') returning id`, [ids[slug]])).rows[0].id;
      ids[`reg:${slug}`] = own;
      await owner.query(
        `insert into agency_credential_maps(tenant_id, connection_id, employer_credential_type_id, employer_type_name, credential_type_id, matched_by) values ($1,$2,$3,'Nursing registration',$4,'hand')`,
        [ids[slug], c, reg, own]);
    }
    // Caring For You's people: Ana and Ben hold the registration, Cara doesn't.
    const expiry = (await owner.query<{ d: string }>(`select to_char(now() + interval '400 days', 'YYYY-MM-DD') as d`)).rows[0].d;
    for (const [first, cred] of [['Ana', true], ['Ben', true], ['Cara', false]] as const) {
      const w = (await owner.query<{ id: string }>(
        `insert into workers(tenant_id, first_name, last_name, roles, email, phone) values ($1,$2,'Example','{Nurse}',$3,'0400000000') returning id`,
        [ids.cfy, first, `${first.toLowerCase()}@example.com`])).rows[0].id;
      people[first] = w;
      await owner.query(`insert into right_to_work_records(tenant_id, worker_id, status, citizen_proof_type, verification) values ($1,$2,'citizen','au_passport','verified')`, [ids.cfy, w]);
      if (cred) await owner.query(`insert into worker_credentials(tenant_id, worker_id, credential_type_id, expiry_date, verification) values ($1,$2,$3,$4,'verified')`, [ids.cfy, w, ids['reg:cfy'], expiry]);
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    delete process.env.APP_URL;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    timer = app.get(AgencyEscalator);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  const mail = async (template: string) =>
    (await owner.query<{ tenant_id: string; to_address: string; subject: string; body: string }>(
      `select tenant_id, to_address, subject, body from notifications where template = $1 order by created_at`, [template])).rows;
  const placed = async (shift: string, who = people.Ana) => {
    const inboxId = await sendToAgency(shift);
    await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('ag')).send({ workerId: who }).expect(200);
    return inboxId;
  };

  it('the agency pulls Ana out: the shift opens again, shown as pulled out, and the employer is emailed', async () => {
    const s = await newShift(30);
    const inboxId = await placed(s);
    // Not from a worker's sign-in, not another business, not a stranger request.
    await http().post(`/agency-requests/${inboxId}/pull-out`).set(as('agw')).send({}).expect(403);
    await http().post(`/agency-requests/${inboxId}/pull-out`).set(as('metro')).send({}).expect(404);
    const res = (await http().post(`/agency-requests/${inboxId}/pull-out`).set(as('ag')).send({ reason: 'Booked twice by mistake' }).expect(200)).body;
    expect(res).toMatchObject({ placement: 'pulled_out', placementState: 'Pulled out' });
    // Twice is refused.
    expect((await http().post(`/agency-requests/${inboxId}/pull-out`).set(as('ag')).send({}).expect(409)).body.message).toMatch(/Nobody of yours/);

    const shift = (await http().get(`/shifts/${s}`).set(as('emp')).expect(200)).body;
    expect(shift).toMatchObject({ status: 'open', workerName: null, pulledOutName: 'Ana Example' });
    expect((await fill(s)).placement).toMatchObject({ status: 'pulled_out', state: 'Pulled out' });
    const log = (await http().get(`/shifts/${s}/history`).set(as('emp')).expect(200)).body;
    expect(log.at(-1)).toMatchObject({ kind: 'pulled_out', via: 'agency', actorName: 'Alex Agent (Caring For You)' });
    expect(await mail('agency_pulled_out')).toEqual([expect.objectContaining({
      tenant_id: ids.bayside, to_address: 'emp@x.com', subject: expect.stringMatching(/^Caring For You pulled Ana Example out: Nurse on /),
      body: expect.stringContaining('Reason from Caring For You: Booked twice by mistake'),
    })]);
    // The agency made the change itself, so it isn't emailed about it.
    await timer.runOnce();
    expect(await mail('agency_placement_changed')).toEqual([]);
    // Ana is free again for the agency, and the employer can send the shift out again.
    const again = await sendToAgency(s);
    const ana = (await http().get(`/agency-requests/${again}/people`).set(as('ag')).expect(200)).body.people.find((p: { name: string }) => p.name === 'Ana Example');
    expect(ana.eligible).toBe(true);
    await http().post(`/shifts/${s}/agency-fill/withdraw`).set(as('emp')).send({}).expect(200);
  });

  it('the agency is emailed when the employer approves, declines, takes off or cancels', async () => {
    await http().patch(`/agency-links/${conn.cfy}`).set(as('emp')).send({ bookMode: 'approve_first' }).expect(200);
    const a = await newShift(50);
    await placed(a, people.Ben);
    // Putting forward itself isn't news to the agency.
    await timer.runOnce();
    expect(await mail('agency_placement_changed')).toEqual([]);

    await http().post(`/shifts/${a}/confirm`).set(as('emp')).send({}).expect(200);
    const d = await newShift(80);
    await placed(d, people.Ben);
    await http().post(`/shifts/${d}/unassign`).set(as('emp')).send({}).expect(200);
    await timer.runOnce();
    let sent = await mail('agency_placement_changed');
    expect(sent.map(m => [m.tenant_id, m.to_address])).toEqual([[ids.cfy, 'ag@x.com'], [ids.cfy, 'ag@x.com']]);
    expect(sent.map(m => m.subject.replace(/ on .*$/, ''))).toEqual(['Bayside Hospital approved Ben Example: Nurse', 'Bayside Hospital declined Ben Example: Nurse']);
    // Nothing goes twice.
    await timer.runOnce();
    expect(await mail('agency_placement_changed')).toHaveLength(2);

    // Booked then cancelled; booked then taken off; booked then recorded as pulled out by the employer.
    await http().post(`/shifts/${a}/cancel`).set(as('emp')).send({ reason: 'Ward closed' }).expect(200);
    await http().patch(`/agency-links/${conn.cfy}`).set(as('emp')).send({ bookMode: 'automatic' }).expect(200);
    const r = await newShift(110);
    await placed(r);
    await http().post(`/shifts/${r}/unassign`).set(as('emp')).send({}).expect(200);
    const p = await newShift(140);
    await placed(p);
    await http().post(`/shifts/${p}/unassign`).set(as('emp')).send({ pulledOut: true }).expect(200);
    await timer.runOnce();
    sent = await mail('agency_placement_changed');
    expect(sent.slice(2).map(m => m.subject.replace(/ on .*$/, ''))).toEqual([
      'Bayside Hospital cancelled a shift for Ben Example: Nurse',
      'Bayside Hospital took Ana Example off a shift: Nurse',
      'Bayside Hospital recorded Ana Example as pulled out: Nurse',
    ]);
    // The employer's own messages never go to the agency, and nothing about the agency's people beyond the name.
    expect(sent.every(m => m.tenant_id === ids.cfy && !/@example\.com/.test(m.body))).toBe(true);
  });

  it('refuses once the shift has started, and when the employer has locked the week', async () => {
    const s = await newShift(170);
    const inboxId = await placed(s);
    await owner.query(`update shifts set starts_at = now() - interval '1 hour', ends_at = now() + interval '7 hours' where id = $1`, [s]);
    expect((await http().post(`/agency-requests/${inboxId}/pull-out`).set(as('ag')).send({}).expect(409)).body.message)
      .toMatch(/already started\. Please contact Bayside Hospital directly/);

    const locked = await newShift(200);
    const in2 = await placed(locked);
    const week = (await owner.query<{ w: string }>(
      `select to_char(date_trunc('week', starts_at at time zone 'Australia/Melbourne'), 'YYYY-MM-DD') as w from shifts where id = $1`, [locked])).rows[0].w;
    await owner.query(`insert into roster_publications(tenant_id, facility_id, week_start, version) values ($1,$2,$3,1)`, [ids.bayside, site, week]);
    await owner.query(`insert into tenant_settings(tenant_id, published_changes) values ($1,'locked') on conflict (tenant_id) do update set published_changes = 'locked'`, [ids.bayside]);
    expect((await http().post(`/agency-requests/${in2}/pull-out`).set(as('ag')).send({}).expect(409)).body.message).toMatch(/locked this week's roster/);
    expect((await http().get(`/shifts/${locked}`).set(as('emp')).expect(200)).body).toMatchObject({ status: 'booked', workerName: 'Ana Example' });
    await owner.query(`update tenant_settings set published_changes = 'open' where tenant_id = $1`, [ids.bayside]);
  });

  it('another business can’t pull anyone out or take another business’s notices', async () => {
    const s = await newShift(230);
    const inboxId = await placed(s);
    await http().post(`/shifts/${s}/unassign`).set(as('emp')).send({}).expect(200);
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    const tx = async (tenant: string, role: string, fn: () => Promise<unknown>) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.actor_role', $2, true)`, [tenant, role]);
      try { await fn(); } finally { await c.query('rollback'); }
    };
    try {
      const s2 = await newShift(260);
      const in2 = await placed(s2);
      await tx(ids.nosy, 'owner', () => expect(c.query(`select * from app_agency_pull_out($1, null)`, [in2])).rejects.toThrow(/Request not found/));
      await tx(ids.metro, 'owner', () => expect(c.query(`select * from app_agency_pull_out($1, null)`, [in2])).rejects.toThrow(/Request not found/));
      await tx(ids.bayside, 'owner', () => expect(c.query(`select * from app_agency_pull_out($1, null)`, [in2])).rejects.toThrow(/Request not found/));
      await tx(ids.cfy, 'worker', () => expect(c.query(`select * from app_agency_pull_out($1, null)`, [in2])).rejects.toThrow(/Only the office/));
      // The notice on Caring For You's copy can only be taken by Caring For You.
      await tx(ids.nosy, 'owner', async () => expect((await c.query(`select app_agency_take_notice($1) as n`, [inboxId])).rows[0].n).toBeNull());
      await tx(ids.bayside, 'owner', async () => expect((await c.query(`select app_agency_take_notice($1) as n`, [inboxId])).rows[0].n).toBeNull());
      await tx(ids.cfy, 'owner', () => expect(c.query(`update agency_inbox set notice = null`)).rejects.toThrow(/permission denied/));
      expect((await owner.query(`select notice from agency_inbox where id = $1`, [inboxId])).rows[0].notice).toBe('removed');
    } finally {
      await c.end();
    }
    await timer.runOnce();
    expect((await owner.query(`select notice from agency_inbox where id = $1`, [inboxId])).rows[0].notice).toBeNull();
  });
});
