import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { agencyAttentionCounts, agencyAttentionItems, requestNote } from '../src/agencies/attention.js';
import { makeWords } from '../src/terms/words.js';
import { startFakeIdp } from './fake-idp.js';

describe('agency needs attention: rules', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
  it('words what has been done about a request and who could go', () => {
    expect(requestNote({ ready: 2, unmatchedMust: 0, offersPending: 0, offersExpired: 0 })).toBe('Not offered to anyone yet; 2 of your workers ready to go');
    expect(requestNote({ ready: 1, unmatchedMust: 0, offersPending: 1, offersExpired: 0 })).toBe('Offered to 1 person, no reply yet; 1 of your worker ready to go');
    expect(requestNote({ ready: 0, unmatchedMust: 0, offersPending: 0, offersExpired: 3 })).toBe('Offer to 3 people ran out with no reply; none of your workers meet the requirements');
    expect(requestNote({ ready: 0, unmatchedMust: 2, offersPending: 0, offersExpired: 0 })).toBe("Not offered to anyone yet; 2 must-haves aren't matched to your credentials yet");
  });
  it('uses the business\'s words', () => {
    const w = makeWords([{ code: 1010, singular: 'Staff member', plural: 'Staff' }]);
    expect(requestNote({ ready: 3, unmatchedMust: 0, offersPending: 0, offersExpired: 0 }, w)).toBe('Not offered to anyone yet; 3 of your staff ready to go');
  });
  it('puts urgent first, then blocked people, open requests, links, and people waiting for approval', () => {
    const items = agencyAttentionItems(
      [{ id: 'r1', startsAt: at(30), employerName: 'Bayside Hospital', ready: 1, unmatchedMust: 0, offersPending: 0, offersExpired: 0 },
       { id: 'r2', startsAt: at(5), employerName: 'Bayside Hospital', ready: 0, unmatchedMust: 0, offersPending: 0, offersExpired: 0 },
       { id: 'gone', startsAt: at(-1), employerName: 'Bayside Hospital', ready: 0, unmatchedMust: 0, offersPending: 0, offersExpired: 0 }],
      [{ id: 'p1', startsAt: at(40), employerName: 'Bayside Hospital', personName: 'Ana Example', placement: 'booked', blocks: ['On approved leave that day.'] },
       { id: 'p2', startsAt: at(10), employerName: 'Bayside Hospital', personName: 'Ben Example', placement: 'waiting', blocks: [] },
       { id: 'p3', startsAt: at(12), employerName: 'Bayside Hospital', personName: 'Cara Example', placement: 'booked', blocks: [] }],
      [{ connectionId: 'c1', employerName: 'Riverside Clinic' }],
      now,
    );
    expect(items.map(i => [i.kind, i.requestId ?? i.connectionId, i.urgent])).toEqual([
      ['open', 'r2', true], ['awaiting_employer', 'p2', true],
      ['person_blocked', 'p1', false], ['open', 'r1', false], ['link_matching', 'c1', false],
    ]);
    expect(items[2]).toMatchObject({ title: "Ana Example can't work Bayside Hospital's shift now", detail: 'On approved leave that day. Pull them out so Bayside Hospital can fill it.', startsIn: 'starts in 40 hours' });
    expect(items[4]).toMatchObject({ title: "Match Riverside Clinic's requirements", startsIn: null });
    expect(agencyAttentionCounts(items)).toEqual({ total: 5, urgent: 2, byKind: { person_blocked: 1, open: 2, link_matching: 1, awaiting_employer: 1 } });
  });
});

describe('agency needs attention: API', () => {
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
    db = await createTestDatabase('crop_agency_attention');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(
      `insert into tenants(slug, name) values ('bayside','Bayside Hospital'),('cfy','Caring For You'),('metro','Metro Nurses'),('nosy','Nosy Staffing'),('river','Riverside Clinic')
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
    process.env.APP_URL = 'https://crop.test';
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
    delete process.env.APP_URL;
  });

  const attention = async (who: string) => (await http().get('/allocations/attention').set(as(who)).expect(200)).body as {
    total: number; urgent: number; byKind: Record<string, number>;
    items: Array<{ kind: string; requestId: string | null; connectionId: string | null; urgent: boolean; title: string; detail: string; request: { role: string; placedName: string | null } | null }>;
  };

  it('lists a link waiting for matching, and nothing for a business that supplies nobody', async () => {
    const c = (await owner.query<{ id: string }>('select gen_random_uuid() as id')).rows[0].id;
    await owner.query(
      `insert into agency_connections(tenant_id, connection_id, side, other_tenant_id, other_name, status, preference) values
         ($1,$3,'employer',$2,'Caring For You','matching',1), ($2,$3,'agency',$1,'Riverside Clinic','matching',null)`, [ids.river, ids.cfy, c]);
    const a = await attention('ag');
    expect(a.items).toEqual([expect.objectContaining({ kind: 'link_matching', connectionId: c, title: "Match Riverside Clinic's requirements", request: null })]);
    expect(await attention('nosy')).toMatchObject({ total: 0, items: [] });
    // The employer's own business has nothing here either (its Needs attention is the roster's).
    expect((await attention('emp')).total).toBe(0);
    await http().get('/allocations/attention').set(as('agw')).expect(403);
    await http().get('/allocations/attention?days=15').set(as('ag')).expect(400);
  });

  it('lists an open request with what has been offered and who is ready; never another agency\'s', async () => {
    const s = await newShift(10);
    const inboxId = await sendToAgency(s);
    let item = (await attention('ag')).items.find(i => i.requestId === inboxId)!;
    expect(item).toMatchObject({ kind: 'open', urgent: true, title: 'Nobody put forward for Bayside Hospital yet', detail: 'Not offered to anyone yet; 2 of your workers ready to go', request: { role: 'Nurse' } });
    await http().post(`/agency-requests/${inboxId}/offers`).set(as('ag')).send({ workerIds: [people.Ana] }).expect(201);
    item = (await attention('ag')).items.find(i => i.requestId === inboxId)!;
    expect(item.detail).toBe('Offered to 1 person, no reply yet; 2 of your workers ready to go');
    // Metro hasn't been sent it yet, and Nosy supplies nobody.
    expect((await attention('metro')).items.some(i => i.requestId === inboxId)).toBe(false);
    expect((await attention('nosy')).total).toBe(0);
    // A request beyond the window isn't listed.
    const later = await newShift(24 * 9);
    const laterId = await sendToAgency(later);
    expect((await attention('ag')).items.some(i => i.requestId === laterId)).toBe(false);
    expect((await http().get('/allocations/attention?days=14').set(as('ag')).expect(200)).body.items.some((i: { requestId: string }) => i.requestId === laterId)).toBe(true);
    await http().post(`/shifts/${s}/agency-fill/withdraw`).set(as('emp')).send({}).expect(200);
    await http().post(`/shifts/${later}/agency-fill/withdraw`).set(as('emp')).send({}).expect(200);
    expect((await attention('ag')).items.some(i => i.requestId === inboxId)).toBe(false);
  });

  it('lists people waiting for approval, and people put forward who can no longer go', async () => {
    await http().patch(`/agency-links/${conn.cfy}`).set(as('emp')).send({ bookMode: 'approve_first' }).expect(200);
    const s = await newShift(50);
    const inboxId = await sendToAgency(s);
    await http().post(`/agency-requests/${inboxId}/put-forward`).set(as('ag')).send({ workerId: people.Ben }).expect(200);
    let item = (await attention('ag')).items.find(i => i.requestId === inboxId)!;
    expect(item).toMatchObject({ kind: 'awaiting_employer', urgent: false, title: 'Waiting for Bayside Hospital to approve Ben Example', request: { placedName: 'Ben Example' } });
    // Booked: nothing to do, so not listed (and the placement itself doesn't count as double booking).
    await http().post(`/shifts/${s}/confirm`).set(as('emp')).send({}).expect(200);
    expect((await attention('ag')).items.some(i => i.requestId === inboxId)).toBe(false);
    // The agency approves leave for Ben on that day: he can't go now.
    const day = (await owner.query<{ d: string }>(`select to_char(starts_at at time zone 'Australia/Melbourne', 'YYYY-MM-DD') as d from shifts where id = $1`, [s])).rows[0].d;
    await owner.query(`insert into leave_records(tenant_id, worker_id, kind, starts_on, ends_on, status) values ($1,$2,'annual',$3,$3,'approved')`, [ids.cfy, people.Ben, day]);
    item = (await attention('ag')).items.find(i => i.requestId === inboxId)!;
    expect(item.kind).toBe('person_blocked');
    expect(item.title).toBe("Ben Example can't work Bayside Hospital's shift now");
    expect(item.detail).toMatch(/leave/i);
    expect(item.detail).not.toMatch(/annual/i);
    expect(item.detail).toMatch(/Pull them out so Bayside Hospital can fill it\.$/);
    // The employer sees nothing of this.
    expect((await attention('emp')).total).toBe(0);
  });
});
