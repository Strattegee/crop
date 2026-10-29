import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { placementWords, putForwardEmail } from '../src/agencies/requests.js';
import { startFakeIdp } from './fake-idp.js';

describe('agency put forward: wording', () => {
  it('reads placements and the employer’s email in plain words', () => {
    expect(placementWords('waiting', 'Bayside Hospital')).toBe('Waiting for Bayside Hospital to approve');
    expect(placementWords('booked')).toBe('Booked');
    expect(placementWords('declined')).toBe('Declined by the employer');
    const base = {
      agencyName: 'Caring For You', personName: 'Ana Example', role: 'Nurse', siteName: 'Bayside Campus', areaName: 'Ward 3',
      startsAt: new Date('2026-11-02T20:00:00Z'), endsAt: new Date('2026-11-03T04:30:00Z'), siteTimezone: 'Australia/Melbourne',
      shiftId: 'abc', weekStart: '2026-11-02',
    };
    const booked = putForwardEmail({ ...base, booked: true }, 'https://staging.cropwms.com/');
    expect(booked.subject).toBe('Caring For You booked Ana Example: Nurse on Tue 3 Nov');
    expect(booked.body).toContain('Nurse at Ward 3, Bayside Campus');
    expect(booked.body).toContain('Ana Example is booked on it.');
    expect(booked.body).toContain('https://staging.cropwms.com/roster?week=2026-11-02&shift=abc#shift-panel');
    const waiting = putForwardEmail({ ...base, booked: false }, null);
    expect(waiting.subject).toBe('Approve Ana Example from Caring For You? Nurse on Tue 3 Nov');
    expect(waiting.body).toContain('waiting for your approval');
  });
});

describe('agency put forward: API', () => {
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
    db = await createTestDatabase('crop_agency_put_forward');
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
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  let booked: string;

  it('booked straight away: the agency puts Ana forward and she is on the employer’s roster', async () => {
    booked = await newShift(30);
    const inboxId = await sendToAgency(booked);
    // Not someone who can't go, not a stranger, not from a worker's sign-in or another business.
    expect((await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('ag')).send({ workerId: people.Cara }).expect(409)).body.message)
      .toMatch(/Cara Example can't go: Cara Example's AHPRA registration is missing/);
    await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('ag')).send({ workerId: ids.cfy }).expect(400);
    await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('agw')).send({ workerId: people.Ana }).expect(403);
    await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('metro')).send({ workerId: people.Ana }).expect(404);

    const res = (await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('ag')).send({ workerId: people.Ana }).expect(200)).body;
    expect(res).toMatchObject({ booked: true, status: 'filled', placement: 'booked', placedName: 'Ana Example', placedWorkerId: people.Ana });
    await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('ag')).send({ workerId: people.Ben }).expect(409);

    // Employer: the shift is booked with Ana from Caring For You; the request is filled; she isn't one of its own people.
    const shift = (await http().get(`/shifts/${booked}`).set(as('emp')).expect(200)).body;
    expect(shift).toMatchObject({ status: 'booked', workerName: 'Ana Example', agencyName: 'Caring For You', assignmentStatus: 'confirmed' });
    const st = await fill(booked);
    expect(st.request).toMatchObject({ status: 'filled' });
    expect(st.placement).toMatchObject({ agencyName: 'Caring For You', workerName: 'Ana Example', status: 'booked', state: 'Booked' });
    expect((await http().get('/workers').set(as('emp')).expect(200)).body).toEqual([]);
    const week = (await owner.query<{ from: string; to: string }>(
      `select to_char(starts_at at time zone 'Australia/Melbourne', 'YYYY-MM-DD') as from, to_char(starts_at at time zone 'Australia/Melbourne' + interval '1 day', 'YYYY-MM-DD') as to from shifts where id = $1`, [booked])).rows[0];
    const roster = (await http().get(`/roster?from=${week.from}&to=${week.to}`).set(as('emp')).expect(200)).body;
    expect(roster.people).toEqual([]);
    expect(roster.agencyPeople).toEqual([expect.objectContaining({ name: 'Ana Example', agencyName: 'Caring For You', rosteredHours: 8 })]);
    // The employer holds her name and agency only: no contact details, no records.
    const row = (await owner.query(`select email, phone, status::text, roles, agency_worker_ref from workers where tenant_id = $1`, [ids.bayside])).rows;
    expect(row).toEqual([{ email: null, phone: null, status: 'agency', roles: [], agency_worker_ref: people.Ana }]);
    // Logged as the agency's change, emailed to the employer's office, and logged on both sides.
    const log = (await http().get(`/shifts/${booked}/history`).set(as('emp')).expect(200)).body;
    expect(log.at(-1)).toMatchObject({ kind: 'booked', via: 'agency', actorName: 'Alex Agent (Caring For You)', summary: 'Ana Example put forward by the agency and booked' });
    const mail = (await owner.query(`select tenant_id, to_address, subject from notifications where template = 'agency_put_forward'`)).rows;
    expect(mail).toEqual([{ tenant_id: ids.bayside, to_address: 'emp@x.com', subject: expect.stringMatching(/^Caring For You booked Ana Example: Nurse on /) }]);
    expect((await owner.query(`select tenant_id from agency_events where action = 'put_forward'`)).rows.map(r => r.tenant_id).sort()).toEqual([ids.bayside, ids.cfy].sort());
    // Nobody else's list shows the person; the agency sees the outcome.
    const mine = (await http().get('/agency-requests?status=all').set(as('ag')).expect(200)).body.find((r: { id: string }) => r.id === inboxId);
    expect(mine).toMatchObject({ placement: 'booked', placementState: 'Booked' });
  });

  it('the agency’s own rostering sees Ana as busy then', async () => {
    const overlap = await newShift(32, 4);
    const inboxId = await sendToAgency(overlap);
    const res = (await http().get(`/agency-requests/${inboxId}/people`).set(as('ag')).expect(200)).body;
    const ana = res.people.find((p: { name: string }) => p.name === 'Ana Example');
    expect(ana.eligible).toBe(false);
    expect(ana.blocks.map((b: { code: string }) => b.code)).toContain('double_booked');
    await http().post(`/shifts/${overlap}/agency-fill/withdraw`).set(as('emp')).send({}).expect(200);
  });

  it('approve first: the person waits (pink) until the employer approves or declines', async () => {
    await http().patch(`/agency-links/${conn.cfy}`).set(as('emp')).send({ bookMode: 'approve_first' }).expect(200);
    const s = await newShift(60);
    const inboxId = await sendToAgency(s);
    const res = (await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('ag')).send({ workerId: people.Ben }).expect(200)).body;
    expect(res).toMatchObject({ booked: false, placement: 'waiting', placementState: 'Waiting for Bayside Hospital to approve' });
    expect((await http().get(`/shifts/${s}`).set(as('emp')).expect(200)).body).toMatchObject({ status: 'assigned', workerName: 'Ben Example', agencyName: 'Caring For You' });
    expect((await fill(s)).placement).toMatchObject({ status: 'waiting', state: 'Waiting for approval' });
    const subject = (await owner.query(`select subject from notifications where template = 'agency_put_forward' order by created_at desc limit 1`)).rows[0].subject;
    expect(subject).toMatch(/^Approve Ben Example from Caring For You\? Nurse on /);
    const attention = (await http().get('/roster/attention?days=14').set(as('emp')).expect(200)).body;
    expect(attention.items.find((i: { shift: { id: string } }) => i.shift.id === s)).toMatchObject({ kind: 'unconfirmed', title: 'Approve Ben Example from Caring For You?' });

    await http().post(`/shifts/${s}/confirm`).set(as('emp')).send({}).expect(200);
    expect((await fill(s)).placement).toMatchObject({ status: 'booked' });
    expect((await http().get('/agency-requests?status=all').set(as('ag')).expect(200)).body.find((r: { id: string }) => r.id === inboxId))
      .toMatchObject({ placement: 'booked' });

    // Declined: the employer takes the waiting person off; the agency sees it and the person is free again.
    const s2 = await newShift(90);
    const in2 = await sendToAgency(s2);
    await http().post(`/agency-requests/${in2}/put-forward`).set(as('ag')).send({ workerId: people.Ben }).expect(200);
    await http().post(`/shifts/${s2}/unassign`).set(as('emp')).send({}).expect(200);
    expect((await fill(s2)).placement).toMatchObject({ status: 'declined' });
    const mine = (await http().get('/agency-requests?status=all').set(as('ag')).expect(200)).body.find((r: { id: string }) => r.id === in2);
    expect(mine).toMatchObject({ placement: 'declined', placementState: 'Declined by the employer' });
    expect((await owner.query(`select placement from agency_inbox where id = $1`, [in2])).rows[0].placement).toBe('declined');

    // Cancelling the shift with someone booked tells the agency too.
    await http().post(`/shifts/${s}/cancel`).set(as('emp')).send({ reason: 'Ward closed' }).expect(200);
    expect((await owner.query(`select placement from agency_inbox where id = $1`, [inboxId])).rows[0].placement).toBe('cancelled');
    await http().patch(`/agency-links/${conn.cfy}`).set(as('emp')).send({ bookMode: 'automatic' }).expect(200);
  });

  it('refuses once the request has closed, and when the employer has locked the week', async () => {
    const s = await newShift(120);
    const inboxId = await sendToAgency(s);
    await http().post(`/shifts/${s}/agency-fill/withdraw`).set(as('emp')).send({}).expect(200);
    expect((await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('ag')).send({ workerId: people.Ana }).expect(400)).body.message).toMatch(/closed/);

    const locked = await newShift(150);
    const in2 = await sendToAgency(locked);
    const week = (await owner.query<{ w: string }>(
      `select to_char(date_trunc('week', starts_at at time zone 'Australia/Melbourne'), 'YYYY-MM-DD') as w from shifts where id = $1`, [locked])).rows[0].w;
    await owner.query(`insert into roster_publications(tenant_id, facility_id, week_start, version) values ($1,$2,$3,1)`, [ids.bayside, site, week]);
    await owner.query(`insert into tenant_settings(tenant_id, published_changes) values ($1,'locked') on conflict (tenant_id) do update set published_changes = 'locked'`, [ids.bayside]);
    expect((await http().post(`/agency-requests/${in2}/put-forward`).set(as('ag')).send({ workerId: people.Ana }).expect(409)).body.message)
      .toMatch(/locked this week's roster/);
    expect((await fill(locked)).request.status).toBe('open');
    await owner.query(`update tenant_settings set published_changes = 'open' where tenant_id = $1`, [ids.bayside]);
  });

  it('crop_app can’t make or change agency people or placements, and another business can’t put anyone forward', async () => {
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    const tx = async (tenant: string, fn: () => Promise<unknown>) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.actor_role', 'owner', true)`, [tenant]);
      try { await fn(); } finally { await c.query('rollback'); }
    };
    try {
      await tx(ids.bayside, () => expect(c.query(`insert into workers(tenant_id, first_name, last_name, status) values ($1,'Fake','Agency','agency')`, [ids.bayside])).rejects.toThrow(/added by the agency/));
      await tx(ids.bayside, () => expect(c.query(`insert into workers(tenant_id, first_name, last_name, agency_connection_id, agency_worker_ref) values ($1,'Fake','Agency',$2,$3)`, [ids.bayside, conn.cfy, people.Ana])).rejects.toThrow(/added by the agency/));
      await tx(ids.bayside, () => expect(c.query(`update workers set status = 'active' where agency_connection_id is not null`)).rejects.toThrow(/kept up to date by the agency/));
      await tx(ids.bayside, () => expect(c.query(`update agency_placements set status = 'booked'`)).rejects.toThrow(/permission denied/));
      await tx(ids.cfy, () => expect(c.query(`update agency_inbox set placement = 'booked'`)).rejects.toThrow(/permission denied/));
      // Nosy (no link) can't use Caring For You's request, even knowing its id.
      const s = await newShift(200);
      const inboxId = await sendToAgency(s);
      await tx(ids.nosy, async () => {
        const nosyWorker = (await c.query<{ id: string }>(`insert into workers(tenant_id, first_name, last_name) values ($1,'Nosy','Person') returning id`, [ids.nosy])).rows[0].id;
        await expect(c.query(`select * from app_agency_put_forward($1, $2)`, [inboxId, nosyWorker])).rejects.toThrow(/Request not found/);
      });
      // Caring For You can't put forward someone from another business.
      const metroWorker = (await owner.query<{ id: string }>(`insert into workers(tenant_id, first_name, last_name) values ($1,'Metro','Person') returning id`, [ids.metro])).rows[0].id;
      await tx(ids.cfy, () => expect(c.query(`select * from app_agency_put_forward($1, $2)`, [inboxId, metroWorker])).rejects.toThrow(/Person not found/));
      // A worker's sign-in can't do it from SQL either.
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.actor_role', 'worker', true)`, [ids.cfy]);
      await expect(c.query(`select * from app_agency_put_forward($1, $2)`, [inboxId, people.Ana])).rejects.toThrow(/Only the office/);
      await c.query('rollback');
    } finally {
      await c.end();
    }
    expect((await owner.query(`select count(*)::int as n from workers where tenant_id = $1 and agency_connection_id is not null`, [ids.nosy])).rows[0].n).toBe(0);
  });
});
