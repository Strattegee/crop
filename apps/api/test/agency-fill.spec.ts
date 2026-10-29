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
import { agencyFillProblem, agencyRules, escalationMinutes, inWords, requestArrivedEmail, roundSchedule } from '../src/agencies/requests.js';
import { startFakeIdp } from './fake-idp.js';

describe('agency fill: rules', () => {
  const zone = 'Australia/Melbourne';
  it('spaces agencies by how soon the shift starts (David, 26 Oct)', () => {
    const now = new Date('2026-11-02T00:00:00Z'); // 11am Melbourne
    expect(escalationMinutes(new Date('2026-11-02T01:30:00Z'), now, zone)).toBe(10);  // 1.5 hours away
    expect(escalationMinutes(new Date('2026-11-02T02:00:00Z'), now, zone)).toBe(10);  // exactly 2 hours
    expect(escalationMinutes(new Date('2026-11-02T08:00:00Z'), now, zone)).toBe(60);  // 7pm today
    expect(escalationMinutes(new Date('2026-11-02T14:00:00Z'), now, zone)).toBe(120); // 1am tomorrow, Melbourne
    const plan = roundSchedule([{ connectionId: 'b', preference: 2 }, { connectionId: 'a', preference: 1 }, { connectionId: 'c', preference: 3 }], now, 10);
    expect(plan.map(p => [p.connectionId, p.position, (p.dueAt.getTime() - now.getTime()) / 60_000])).toEqual([['a', 1, 0], ['b', 2, 10], ['c', 3, 20]]);
  });

  it('says why a shift can’t go to agencies, and reads times in words', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    const later = new Date('2026-11-03T00:00:00Z');
    const open = { status: 'open' as const, equipmentOnly: false, startsAt: later };
    expect(agencyFillProblem(open, 1, false, now)).toBeNull();
    expect(agencyFillProblem(open, 0, false, now)).toMatch(/Settings → Agencies/);
    expect(agencyFillProblem(open, 1, true, now)).toMatch(/already been sent/);
    expect(agencyFillProblem({ ...open, status: 'assigned' }, 1, false, now)).toMatch(/Someone is already/);
    expect(agencyFillProblem({ ...open, status: 'cancelled' }, 1, false, now)).toMatch(/cancelled/);
    expect(agencyFillProblem({ ...open, equipmentOnly: true }, 1, false, now)).toMatch(/equipment-only/);
    expect(agencyFillProblem({ ...open, startsAt: now }, 1, false, now)).toMatch(/already started/);
    expect(inWords(0)).toBe('now');
    expect(inWords(10 * 60_000)).toBe('in 10 minutes');
    expect(inWords(90 * 60_000)).toBe('in 1 hour 30 minutes');
    expect(inWords(120 * 60_000)).toBe('in 2 hours');
    expect(inWords(29.5 * 3600_000)).toBe('in 1 day 6 hours');
    expect(inWords(24 * 3600_000)).toBe('in 1 day');
    expect(inWords(80 * 3600_000)).toBe('in 3 days');
  });

  it('writes the agency’s email with the shift and requirements, no people', () => {
    const { subject, body } = requestArrivedEmail({
      employerName: 'Bayside Hospital', siteName: 'Bayside Campus', siteTimezone: 'Australia/Melbourne', areaName: 'Ward 3', role: 'Nurse',
      startsAt: new Date('2026-11-02T20:00:00Z'), endsAt: new Date('2026-11-03T04:30:00Z'), duties: ['Medication round'],
      requirements: [{ name: 'Registration', severity: 'hard', forDuty: null, credentialTypeId: null }, { name: 'Barista', severity: 'optional', forDuty: null, credentialTypeId: null }],
      note: 'Ask for Sam at the desk',
    }, 'https://staging.cropwms.com/');
    expect(subject).toBe('Bayside Hospital: Nurse on Tue 3 Nov');
    expect(body).toContain('Nurse at Ward 3, Bayside Campus');
    expect(body).toContain('Tue 3 Nov, 7:00am to 3:30pm');
    expect(body).toContain('1 of its requirements isn\'t matched');
    expect(body).toContain('https://staging.cropwms.com/allocations');
  });
});

describe('agency fill: the agency\'s rules for a request', () => {
  it('uses the current match, blocks everyone on an unmatched must-have, lists an unmatched should-have, skips optional', () => {
    const names = new Map([['own-a', 'AHPRA registration'], ['own-b', 'First aid']]);
    const r = agencyRules([
      { requirementId: 'emp-1', name: 'Nursing registration', severity: 'hard', forDuty: null, credentialTypeId: 'old' },
      { name: 'CPR', severity: 'warning', forDuty: 'Pool', credentialTypeId: 'own-b' },                         // older request: the match it came with
      { requirementId: 'emp-3', name: 'Police check', severity: 'hard', forDuty: null, credentialTypeId: 'own-b' }, // match removed since
      { requirementId: 'emp-4', name: 'Manual handling', severity: 'warning', forDuty: null, credentialTypeId: null },
      { name: 'Barista', severity: 'optional', forDuty: null, credentialTypeId: null },
    ], new Map([['emp-1', 'own-a']]), names, 'Bayside Hospital');
    expect(r.rules).toEqual([
      { credentialTypeId: 'own-a', typeName: 'AHPRA registration', scope: 'all_workers', role: null, severity: 'hard' },
      { credentialTypeId: 'own-b', typeName: 'First aid', scope: 'all_workers', role: null, severity: 'warning', forDuty: 'Pool' },
    ]);
    expect(r.blockAll).toEqual(["Bayside Hospital's Police check isn't matched to your credentials yet"]);
    expect(r.unmatched).toEqual([{ name: 'Police check', severity: 'hard' }, { name: 'Manual handling', severity: 'warning' }]);
  });
});

describe('agency fill: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let timer: AgencyEscalator;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const conn: Record<string, string> = {};
  let site: string;

  const newShift = async (hoursAhead: number, extra: { needsPerson?: boolean } = {}) =>
    (await owner.query<{ id: string }>(
      `insert into shifts(tenant_id, facility_id, role, starts_at, ends_at, needs_person)
       values ($1, $2, 'Nurse', now() + make_interval(hours => $3), now() + make_interval(hours => $3 + 8), $4) returning id`,
      [ids.bayside, site, hoursAhead, extra.needsPerson ?? true])).rows[0].id;
  const inbox = async (who: string) => (await http().get('/agency-requests?status=all').set(as(who)).expect(200)).body;

  beforeAll(async () => {
    db = await createTestDatabase('crop_agency_fill');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(
      `insert into tenants(slug, name) values ('bayside','Bayside Hospital'),('cfy','Caring For You'),('metro','Metro Nurses'),('nosy','Nosy Staffing')
       returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(
      `insert into invitations(tenant_id, email, role) values ($1,'emp@x.com','owner'),($1,'empalloc@x.com','allocator'),
         ($2,'ag@x.com','admin'),($3,'metro@x.com','owner'),($4,'nosy@x.com','owner')`, [ids.bayside, ids.cfy, ids.metro, ids.nosy]);
    for (const [sub, email] of [['emp', 'emp@x.com'], ['empalloc', 'empalloc@x.com'], ['ag', 'ag@x.com'], ['metro', 'metro@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    site = (await owner.query<{ id: string }>(`insert into facilities(tenant_id, name, timezone) values ($1, 'Bayside Campus', 'Australia/Melbourne') returning id`, [ids.bayside])).rows[0].id;
    // The employer needs a registration for nurses (must have) and lists a barista course as optional.
    const reg = (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category) values ($1, 'Nursing registration', 'registration') returning id`, [ids.bayside])).rows[0].id;
    const bar = (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category) values ($1, 'Barista course', 'training') returning id`, [ids.bayside])).rows[0].id;
    await owner.query(`insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity) values ($1,$2,'role','Nurse','hard'),($1,$3,'all_workers',null,'optional')`, [ids.bayside, reg, bar]);
    // Two active links (Caring For You first, Metro second), matched; Nosy is an employer with no link to anyone.
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

  let first: string;

  it('sends an open shift to the first agency now and the next one later', async () => {
    first = await newShift(30); // tomorrow or later: 2 hours between agencies
    const before = (await http().get(`/shifts/${first}/agency-fill`).set(as('empalloc')).expect(200)).body;
    expect(before).toMatchObject({ request: null, rounds: [], activeAgencies: 2, canRequest: true, problem: null });
    await http().post(`/shifts/${first}/agency-fill`).set(as('ag')).send({}).expect(404); // not the agency's shift

    const st = (await http().post(`/shifts/${first}/agency-fill`).set(as('empalloc')).send({ note: 'Ask for Sam at the desk' }).expect(201)).body;
    expect(st.request).toMatchObject({ status: 'open', note: 'Ask for Sam at the desk' });
    expect(st.rounds.map((r: { agencyName: string; state: string; sentHow: string | null }) => [r.agencyName, r.state, r.sentHow]))
      .toEqual([['Caring For You', 'sent', 'first'], ['Metro Nurses', 'waiting', null]]);
    expect(st.next).toMatchObject({ agencyName: 'Metro Nurses', dueIn: 'in 2 hours' });
    expect(st.canRequest).toBe(false);
    expect(st.problem).toMatch(/already been sent/);
    await http().post(`/shifts/${first}/agency-fill`).set(as('empalloc')).send({}).expect(400);

    // Caring For You sees it (with its own matched credential); Metro and Nosy see nothing yet.
    const got = await inbox('ag');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ employerName: 'Bayside Hospital', siteName: 'Bayside Campus', role: 'Nurse', status: 'open', note: 'Ask for Sam at the desk', unmatched: 0 });
    expect(got[0].requirements).toEqual([
      { requirementId: expect.any(String), name: 'Nursing registration', severity: 'hard', forDuty: null, credentialTypeId: ids['reg:cfy'] },
      { requirementId: expect.any(String), name: 'Barista course', severity: 'optional', forDuty: null, credentialTypeId: null },
    ]);
    expect(await inbox('metro')).toEqual([]);
    expect(await inbox('nosy')).toEqual([]);
    expect((await http().get(`/agency-requests/${got[0].id}`).set(as('ag')).expect(200)).body.id).toBe(got[0].id);
    await http().get(`/agency-requests/${got[0].id}`).set(as('metro')).expect(404);
    await http().get(`/shifts/${first}/agency-fill`).set(as('ag')).expect(404);

    // The agency's owner/admin is emailed, in the agency's own message log.
    const mail = (await owner.query(`select tenant_id, to_address, subject, body from notifications where template = 'agency_request'`)).rows;
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ tenant_id: ids.cfy, to_address: 'ag@x.com' });
    expect(mail[0].body).toContain('Bayside Hospital has asked you to fill a shift');
    // Logged on both sides.
    expect((await owner.query(`select tenant_id from agency_events where action = 'request_sent' order by tenant_id`)).rows.map(r => r.tenant_id).sort())
      .toEqual([ids.bayside, ids.cfy].sort());
  });

  it('the agency sees its own people for a request, checked against the employer’s requirements', async () => {
    const inboxId = (await inbox('ag'))[0].id as string;
    const today = (await owner.query<{ d: string }>(`select to_char(now() + interval '400 days', 'YYYY-MM-DD') as d`)).rows[0].d;
    const person = async (first: string, roles: string[], cred: boolean) => {
      const w = (await owner.query<{ id: string }>(
        `insert into workers(tenant_id, first_name, last_name, roles) values ($1,$2,'Example',$3) returning id`, [ids.cfy, first, roles])).rows[0].id;
      await owner.query(`insert into right_to_work_records(tenant_id, worker_id, status, citizen_proof_type, verification) values ($1,$2,'citizen','au_passport','verified')`, [ids.cfy, w]);
      if (cred) await owner.query(`insert into worker_credentials(tenant_id, worker_id, credential_type_id, expiry_date, verification) values ($1,$2,$3,$4,'verified')`, [ids.cfy, w, ids['reg:cfy'], today]);
      return w;
    };
    await person('Ana', ['Nurse'], true);
    await person('Ben', ['Registered Nurse'], true);
    await person('Cara', ['Nurse'], false);
    // Someone at Bayside itself never appears.
    await owner.query(`insert into workers(tenant_id, first_name, last_name, roles) values ($1,'Bayside','Staff','{Nurse}')`, [ids.bayside]);

    let res = (await http().get(`/agency-requests/${inboxId}/people`).set(as('ag')).expect(200)).body;
    expect(res.ready).toBe(2);
    expect(res.unmatched).toEqual([]);
    expect(res.people.map((p: { name: string; eligible: boolean }) => [p.name, p.eligible])).toEqual([['Ana Example', true], ['Ben Example', true], ['Cara Example', false]]);
    expect(res.people[1].warnings.map((w: { code: string }) => w.code)).toEqual(['role']);
    expect(res.people[2].blocks.map((b: { message: string }) => b.message)).toEqual(["Cara Example's AHPRA registration is missing"]);
    await http().get(`/agency-requests/${inboxId}/people`).set(as('metro')).expect(404);
    await http().get(`/agency-requests/${inboxId}/people`).set(as('emp')).expect(404);

    // The agency removes its match: nobody can be checked against that requirement, so nobody is ready.
    await owner.query(`delete from agency_credential_maps where tenant_id = $1`, [ids.cfy]);
    res = (await http().get(`/agency-requests/${inboxId}/people`).set(as('ag')).expect(200)).body;
    expect(res.ready).toBe(0);
    expect(res.unmatched).toEqual([{ name: 'Nursing registration', severity: 'hard' }]);
    expect(res.people[0].blocks.map((b: { message: string }) => b.message)).toContain("Bayside Hospital's Nursing registration isn't matched to your credentials yet");
    await owner.query(
      `insert into agency_credential_maps(tenant_id, connection_id, employer_credential_type_id, employer_type_name, credential_type_id, matched_by)
       select $1, $2, ct.id, ct.name, $3, 'hand' from credential_types ct where ct.tenant_id = $4 and ct.name = 'Nursing registration'`,
      [ids.cfy, conn.cfy, ids['reg:cfy'], ids.bayside]);
  });

  it('the timer sends it on when the next agency’s turn comes; the office can bring it forward', async () => {
    expect(await timer.runOnce()).toBe(0);
    await owner.query(`update agency_request_rounds set due_at = now() - interval '1 minute' where agency_name = 'Metro Nurses'`);
    expect(await timer.runOnce()).toBe(1);
    expect(await timer.runOnce()).toBe(0);
    const st = (await http().get(`/shifts/${first}/agency-fill`).set(as('emp')).expect(200)).body;
    expect(st.rounds.map((r: { state: string; sentHow: string }) => [r.state, r.sentHow])).toEqual([['sent', 'first'], ['sent', 'timer']]);
    expect(st.next).toBeNull();
    expect(await inbox('metro')).toHaveLength(1);
    await http().post(`/shifts/${first}/agency-fill/next`).set(as('emp')).expect(400);

    const s2 = await newShift(48);
    await http().post(`/shifts/${s2}/agency-fill/next`).set(as('emp')).expect(400);
    await http().post(`/shifts/${s2}/agency-fill`).set(as('emp')).send({}).expect(201);
    const st2 = (await http().post(`/shifts/${s2}/agency-fill/next`).set(as('empalloc')).expect(200)).body;
    expect(st2.rounds.map((r: { state: string; sentHow: string }) => [r.state, r.sentHow])).toEqual([['sent', 'first'], ['sent', 'manual']]);
    await http().post(`/shifts/${s2}/agency-fill/withdraw`).set(as('emp')).send({ reason: 'Covered by our own staff' }).expect(200);
  });

  it('withdrawing, filling or cancelling the shift closes it for every agency', async () => {
    let st = (await http().post(`/shifts/${first}/agency-fill/withdraw`).set(as('empalloc')).send({}).expect(200)).body;
    expect(st.request).toMatchObject({ status: 'withdrawn', closedReason: 'Withdrawn by the employer' });
    expect(st.canRequest).toBe(true);
    await http().post(`/shifts/${first}/agency-fill/withdraw`).set(as('empalloc')).send({}).expect(400);
    const forCfy = (await inbox('ag')).filter((r: { status: string }) => r.status !== 'open');
    expect(forCfy.length).toBeGreaterThan(0);
    expect((await http().get('/agency-requests').set(as('ag')).expect(200)).body).toEqual([]);

    // Sent again, then the employer fills it some other way: closed as filled for both agencies.
    await http().post(`/shifts/${first}/agency-fill`).set(as('empalloc')).send({}).expect(201);
    await owner.query(`update shifts set status = 'booked' where id = $1`, [first]);
    st = (await http().get(`/shifts/${first}/agency-fill`).set(as('emp')).expect(200)).body;
    expect(st.request).toMatchObject({ status: 'filled', closedReason: 'The shift has been filled' });
    expect(st.rounds.map((r: { state: string; skippedReason: string | null }) => [r.state, r.skippedReason])).toEqual([['sent', null], ['skipped', 'The request had closed']]);
    expect(st.problem).toMatch(/Someone is already/);
    const latest = (await inbox('ag'))[0];
    expect(latest).toMatchObject({ status: 'filled', closedReason: 'The shift has been filled' });

    const c = await newShift(26);
    await http().post(`/shifts/${c}/agency-fill`).set(as('emp')).send({}).expect(201);
    await owner.query(`update shifts set status = 'cancelled', cancelled_reason = 'Ward closed' where id = $1`, [c]);
    expect((await http().get(`/shifts/${c}/agency-fill`).set(as('emp')).expect(200)).body.request).toMatchObject({ status: 'withdrawn', closedReason: 'The shift was cancelled' });
  });

  it('refuses equipment-only shifts, shifts already started, and businesses with no active agency', async () => {
    const eq = await newShift(30, { needsPerson: false });
    expect((await http().post(`/shifts/${eq}/agency-fill`).set(as('emp')).send({}).expect(400)).body.message).toMatch(/equipment-only/);
    const nosyShift = (await owner.query<{ id: string }>(
      `with f as (insert into facilities(tenant_id, name) values ($1, 'Nosy HQ') returning id)
       insert into shifts(tenant_id, facility_id, role, starts_at, ends_at) select $1, f.id, 'Nurse', now() + interval '30 hours', now() + interval '38 hours' from f returning id`,
      [ids.nosy])).rows[0].id;
    expect((await http().post(`/shifts/${nosyShift}/agency-fill`).set(as('nosy')).send({}).expect(400)).body.message).toMatch(/No agency can be sent requests/);
    await http().get(`/shifts/${nosyShift}/agency-fill`).set(as('emp')).expect(404);
  });

  it('closes requests when the shift starts', async () => {
    const s = await newShift(3);
    await http().post(`/shifts/${s}/agency-fill`).set(as('emp')).send({}).expect(201);
    expect((await http().get(`/shifts/${s}/agency-fill`).set(as('emp')).expect(200)).body.next.dueIn).toBe('in 1 hour');
    await owner.query(`update shifts set starts_at = now() - interval '1 minute' where id = $1`, [s]);
    await timer.runOnce();
    const st = (await http().get(`/shifts/${s}/agency-fill`).set(as('emp')).expect(200)).body;
    expect(st.request).toMatchObject({ status: 'expired', closedReason: 'The shift has started' });
    expect(st.rounds[1].state).toBe('skipped');
  });

  it('ending a link closes that agency’s open requests and skips its turn', async () => {
    const s = await newShift(50);
    await http().post(`/shifts/${s}/agency-fill`).set(as('emp')).send({}).expect(201);
    // Metro's link ends before its turn; Caring For You's link ends with the request open in its list.
    await http().post(`/agency-links/${conn.metro}/end`).set(as('metro')).send({ reason: 'Not taking new clients' }).expect(200);
    let st = (await http().get(`/shifts/${s}/agency-fill`).set(as('emp')).expect(200)).body;
    expect(st.rounds[1]).toMatchObject({ state: 'skipped', skippedReason: 'The link has ended' });
    await http().post(`/agency-links/${conn.cfy}/end`).set(as('emp')).send({}).expect(200);
    const open = (await http().get('/agency-requests').set(as('ag')).expect(200)).body;
    expect(open).toEqual([]);
    expect((await inbox('ag'))[0]).toMatchObject({ status: 'withdrawn', closedReason: 'The link has ended' });
    st = (await http().get(`/shifts/${s}/agency-fill`).set(as('emp')).expect(200)).body;
    expect(st.activeAgencies).toBe(0);
  });

  it('crop_app can’t write an agency’s list or forge a request for another business’s shift', async () => {
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [ids.cfy]);
      await expect(c.query(`update agency_inbox set status = 'open'`)).rejects.toThrow(/permission denied/);
      await c.query('rollback');
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [ids.bayside]);
      await expect(c.query(`update agency_requests set status = 'open', closed_at = null`)).rejects.toThrow(/permission denied/);
      await c.query('rollback');
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [ids.cfy]);
      await expect(c.query(`select app_agency_send_due(gen_random_uuid(), 'first')`)).rejects.toThrow(/Only the office/);
      await c.query('rollback');

      // Nosy links to Metro, then tries to send Metro a request pointing at Bayside's shift: nothing crosses over.
      const nc = (await owner.query<{ id: string }>('select gen_random_uuid() as id')).rows[0].id;
      await owner.query(
        `insert into agency_connections(tenant_id, connection_id, side, other_tenant_id, other_name, status, preference) values
           ($1,$3,'employer',$2,'Metro Nurses','active',1), ($2,$3,'agency',$1,'Nosy Staffing','active',null)`, [ids.nosy, ids.metro, nc]);
      const bayShift = await newShift(60);
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.actor_role', 'owner', true)`, [ids.nosy]);
      const req = (await c.query<{ id: string }>(`insert into agency_requests(tenant_id, shift_id) values ($1,$2) returning id`, [ids.nosy, bayShift])).rows[0].id;
      await c.query(`insert into agency_request_rounds(tenant_id, request_id, connection_id, agency_name, position, due_at) values ($1,$2,$3,'Metro Nurses',1,now())`, [ids.nosy, req, nc]);
      await expect(c.query(`insert into agency_request_rounds(tenant_id, request_id, connection_id, agency_name, position, due_at, sent_at) values ($1,$2,$3,'x',2,now(),now())`, [ids.nosy, req, nc]))
        .rejects.toThrow(/permission denied/);
      await c.query('rollback');
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.actor_role', 'owner', true)`, [ids.nosy]);
      const req2 = (await c.query<{ id: string }>(`insert into agency_requests(tenant_id, shift_id) values ($1,$2) returning id`, [ids.nosy, bayShift])).rows[0].id;
      await c.query(`insert into agency_request_rounds(tenant_id, request_id, connection_id, agency_name, position, due_at) values ($1,$2,$3,'Metro Nurses',1,now())`, [ids.nosy, req2, nc]);
      expect((await c.query(`select * from app_agency_send_due($1, 'first')`, [req2])).rows).toEqual([]);
      expect((await c.query(`select skipped_reason from agency_request_rounds where request_id = $1`, [req2])).rows[0].skipped_reason).toBe("Not this business's request");
      // And Bayside's requests can't be withdrawn from Nosy.
      const bayReq = (await owner.query<{ id: string }>(`select id from agency_requests where tenant_id = $1 limit 1`, [ids.bayside])).rows[0].id;
      await c.query('savepoint s');
      await expect(c.query(`select app_agency_withdraw_request($1, null)`, [bayReq])).rejects.toThrow(/Request not found/);
      await c.query('rollback to savepoint s');
      await c.query('commit');
    } finally {
      await c.end();
    }
    expect((await owner.query(`select count(*)::int as n from agency_inbox where tenant_id = $1 and request_ref in (select id from agency_requests where tenant_id = $2)`, [ids.metro, ids.nosy])).rows[0].n).toBe(0);
  });
});
