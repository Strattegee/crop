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
import { agencyAcceptedMessage, agencyFilledMessage, agencyOfferMessage } from '../src/agencies/requests.js';
import { startFakeIdp } from './fake-idp.js';

describe('agency offers: wording', () => {
  const s = {
    employerName: 'Bayside Hospital', role: 'Nurse', siteName: 'Bayside Campus', areaName: 'Ward 3',
    startsAt: new Date('2026-11-02T20:00:00Z'), endsAt: new Date('2026-11-03T04:30:00Z'), siteTimezone: 'Australia/Melbourne',
  };
  it('offers, confirms and closes in plain words, from the agency', () => {
    const m = agencyOfferMessage('Ana', 'Caring For You', s, null, 'https://crop.test/agency-offer/abc');
    expect(m.subject).toBe('Shift available: Nurse on Tue 3 Nov');
    expect(m.sms).toBe('Hi Ana, Caring For You has a shift for you: Nurse at Ward 3, Bayside Campus (Bayside Hospital), Tue 3 Nov, 7:00am to 3:30pm. Accept or decline: https://crop.test/agency-offer/abc (first to accept goes).');
    expect(m.email).toContain("This link is just for you, so please don't forward it.");
    expect(agencyOfferMessage('Ana', 'Caring For You', s, '6:00pm Mon 2 Nov', null).email).toContain("Contact Caring For You if you'd like it. The first person to accept goes. The offer is open until 6:00pm Mon 2 Nov.");
    expect(agencyAcceptedMessage('Ana', 'Caring For You', s, true).sms).toBe('Hi Ana, thanks for taking the shift: Nurse at Ward 3, Bayside Campus (Bayside Hospital), Tue 3 Nov, 7:00am to 3:30pm. You\'re booked.');
    expect(agencyAcceptedMessage('Ana', 'Caring For You', s, false).email).toContain("Bayside Hospital approves people from Caring For You first, so you're not booked yet.");
    expect(agencyFilledMessage('Ben', 'Caring For You', s).subject).toBe('Shift filled: Nurse on Tue 3 Nov');
  });
});

describe('agency offers: API', () => {
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
    db = await createTestDatabase('crop_agency_offers');
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
    process.env.APP_URL = 'https://crop.test';
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
    delete process.env.APP_URL;
  });

  const sent = async (template: string, to?: string) =>
    (await owner.query<{ tenant_id: string; channel: string; to_address: string; subject: string | null; body: string }>(
      `select tenant_id, channel, to_address, subject, body from notifications where template = $1 and ($2::text is null or to_address = $2) order by created_at`, [template, to ?? null])).rows;
  /** The token in the latest offer email to someone. */
  const tokenFor = async (email: string) => {
    const m = (await sent('agency_offer', email)).at(-1)!;
    return /agency-offer\/([A-Za-z0-9_-]{43})/.exec(m.body)![1];
  };
  const link = () => request(app.getHttpServer());

  it('offers to Ana and Ben; Ben says yes from his link and goes; Ana is told it has gone', async () => {
    const s = await newShift(30);
    const inboxId = await sendToAgency(s);
    // Cara can't go; a worker's sign-in and another business can't offer.
    expect((await http().post(`/agency-requests/${inboxId}/offers`).set(as('ag')).send({ workerIds: [people.Ana, people.Cara] }).expect(409)).body.message)
      .toMatch(/Cara Example can't go/);
    await http().post(`/agency-requests/${inboxId}/offers`).set(as('agw')).send({ workerIds: [people.Ana] }).expect(403);
    await http().post(`/agency-requests/${inboxId}/offers`).set(as('metro')).send({ workerIds: [people.Ana] }).expect(404);

    const res = (await http().post(`/agency-requests/${inboxId}/offers`).set(as('ag')).send({ workerIds: [people.Ana, people.Ben] }).expect(201)).body;
    expect(res).toMatchObject({ offered: 2, alreadyOffered: 0, messages: 4 });
    expect(res.offers.map((o: { workerName: string; state: string }) => [o.workerName, o.state]).sort()).toEqual([['Ana Example', 'pending'], ['Ben Example', 'pending']]);
    // Asking again doesn't ask twice.
    expect((await http().post(`/agency-requests/${inboxId}/offers`).set(as('ag')).send({ workerIds: [people.Ana] }).expect(201)).body).toMatchObject({ offered: 0, alreadyOffered: 1 });
    const offers = await sent('agency_offer');
    expect(offers.filter(m => m.channel === 'sms')).toHaveLength(2);
    expect(offers.every(m => m.tenant_id === ids.cfy)).toBe(true);
    // Nothing has reached the employer yet.
    expect((await http().get(`/shifts/${s}`).set(as('emp')).expect(200)).body).toMatchObject({ status: 'open' });

    const ben = await tokenFor('ben@example.com');
    const ana = await tokenFor('ana@example.com');
    const view = (await link().get(`/agency-offer-links/${ben}`).expect(200)).body;
    expect(view).toMatchObject({ business: 'Caring For You', firstName: 'Ben', status: 'pending', employer: 'Bayside Hospital',
      shift: { role: 'Nurse', site: 'Bayside Campus', timezone: 'Australia/Melbourne' }, word: { one: 'Shift', lower: 'shift' } });
    expect(JSON.stringify(view)).not.toMatch(/example\.com|0400000000|AHPRA/);
    await link().get('/agency-offer-links/not-a-token').expect(404);
    await link().get(`/agency-offer-links/${'x'.repeat(43)}`).expect(404);

    expect((await link().post(`/agency-offer-links/${ben}/accept`).expect(200)).body).toMatchObject({ status: 'accepted' });
    expect((await http().get(`/shifts/${s}`).set(as('emp')).expect(200)).body).toMatchObject({ status: 'booked', workerName: 'Ben Example', agencyName: 'Caring For You' });
    const log = (await http().get(`/shifts/${s}/history`).set(as('emp')).expect(200)).body;
    expect(log.at(-1)).toMatchObject({ kind: 'booked', via: 'agency', actorName: 'Ben Example (Caring For You)' });
    expect(await sent('agency_put_forward')).toEqual([expect.objectContaining({ tenant_id: ids.bayside, to_address: 'emp@x.com' })]);
    expect((await sent('agency_offer_accepted', 'ben@example.com'))[0]).toMatchObject({ subject: expect.stringMatching(/^Booked: Nurse on /) });
    expect(await sent('agency_offer_filled')).toEqual([expect.objectContaining({ to_address: 'ana@example.com', channel: 'email' })]);
    // Ana's link now says it's gone; Ben's says he's booked.
    expect((await link().get(`/agency-offer-links/${ana}`).expect(200)).body.status).toBe('filled');
    expect((await link().post(`/agency-offer-links/${ana}/accept`).expect(409)).body.message).toMatch(/already been filled/);
    expect((await link().post(`/agency-offer-links/${ben}/accept`).expect(409)).body.message).toMatch(/already accepted/);
    const mine = (await http().get(`/agency-requests/${inboxId}/offers`).set(as('ag')).expect(200)).body;
    expect(mine.map((o: { workerName: string; state: string; respondedVia: string | null }) => [o.workerName, o.state, o.respondedVia]).sort())
      .toEqual([['Ana Example', 'filled', null], ['Ben Example', 'accepted', 'link']]);
  });

  it('a no from the link, the office recording a yes, expiry, withdrawing, and the employer taking it back', async () => {
    await http().patch(`/agency-links/${conn.cfy}`).set(as('emp')).send({ bookMode: 'approve_first' }).expect(200);
    const s = await newShift(60);
    const inboxId = await sendToAgency(s);
    const res = (await http().post(`/agency-requests/${inboxId}/offers`).set(as('ag')).send({ workerIds: [people.Ana, people.Ben], expiresInMinutes: 30 }).expect(201)).body;
    const anaOffer = res.offers.find((o: { workerName: string }) => o.workerName === 'Ana Example');
    const ben = await tokenFor('ben@example.com');
    expect((await link().post(`/agency-offer-links/${ben}/decline`).expect(200)).body.status).toBe('declined');
    expect((await link().post(`/agency-offer-links/${ben}/decline`).expect(409)).body.message).toMatch(/already said no/);
    // The office records Ana's yes: she waits for the employer's approval.
    expect((await http().post(`/agency-offers/${anaOffer.id}/accept`).set(as('ag')).expect(200)).body).toMatchObject({ booked: false, name: 'Ana Example' });
    expect((await http().get(`/shifts/${s}`).set(as('emp')).expect(200)).body).toMatchObject({ status: 'assigned', workerName: 'Ana Example' });
    expect((await sent('agency_offer_accepted', 'ana@example.com')).at(-1)).toMatchObject({ subject: expect.stringMatching(/^Waiting for approval: Nurse on /) });
    await http().patch(`/agency-links/${conn.cfy}`).set(as('emp')).send({ bookMode: 'automatic' }).expect(200);

    // Expired: the link refuses; asking again closes the old offer and makes a new one.
    const s2 = await newShift(90);
    const in2 = await sendToAgency(s2);
    await http().post(`/agency-requests/${in2}/offers`).set(as('ag')).send({ workerIds: [people.Ben], expiresInMinutes: 5 }).expect(201);
    const old = await tokenFor('ben@example.com');
    await owner.query(`update agency_offers set expires_at = now() - interval '1 minute' where inbox_id = $1`, [in2]);
    expect((await link().get(`/agency-offer-links/${old}`).expect(200)).body.status).toBe('expired');
    expect((await link().post(`/agency-offer-links/${old}/accept`).expect(409)).body.message).toMatch(/expired. Contact Caring For You/);
    expect((await http().post(`/agency-requests/${in2}/offers`).set(as('ag')).send({ workerIds: [people.Ben] }).expect(201)).body.offered).toBe(1);
    // Withdrawn by the agency: links stop working.
    expect((await http().post(`/agency-requests/${in2}/offers/withdraw`).set(as('ag')).expect(200)).body.withdrawn).toBe(1);
    expect((await link().get(`/agency-offer-links/${await tokenFor('ben@example.com')}`).expect(200)).body.status).toBe('withdrawn');
    // The employer takes the request back: pending offers close too.
    await http().post(`/agency-requests/${in2}/offers`).set(as('ag')).send({ workerIds: [people.Ben] }).expect(201);
    await http().post(`/shifts/${s2}/agency-fill/withdraw`).set(as('emp')).send({}).expect(200);
    const after = (await http().get(`/agency-requests/${in2}/offers`).set(as('ag')).expect(200)).body;
    expect(after.filter((o: { state: string }) => o.state === 'pending')).toEqual([]);
    expect((await link().post(`/agency-offer-links/${await tokenFor('ben@example.com')}/accept`).expect(409)).body.message).toMatch(/filled or taken back/);
    expect((await http().post(`/agency-requests/${in2}/offers`).set(as('ag')).send({ workerIds: [people.Ben] }).expect(409)).body.message).toMatch(/closed/);
  });

  it('a person who can no longer go is refused from the link with a plain reason', async () => {
    const s = await newShift(120);
    const inboxId = await sendToAgency(s);
    await http().post(`/agency-requests/${inboxId}/offers`).set(as('ag')).send({ workerIds: [people.Ana] }).expect(201);
    await owner.query(`update worker_credentials set expiry_date = current_date - 1 where worker_id = $1`, [people.Ana]);
    try {
      expect((await link().post(`/agency-offer-links/${await tokenFor('ana@example.com')}/accept`).expect(409)).body.message)
        .toBe("You can't be put forward for this shift right now. Contact Caring For You to sort it out.");
      expect((await http().get(`/shifts/${s}`).set(as('emp')).expect(200)).body.status).toBe('open');
    } finally {
      await owner.query(`update worker_credentials set expiry_date = current_date + 400 where worker_id = $1`, [people.Ana]);
    }
  });

  it('another business can’t accept, see or change an agency’s offers', async () => {
    const s = await newShift(150);
    const inboxId = await sendToAgency(s);
    const offer = (await http().post(`/agency-requests/${inboxId}/offers`).set(as('ag')).send({ workerIds: [people.Ana] }).expect(201)).body.offers[0];
    await http().get(`/agency-requests/${inboxId}/offers`).set(as('metro')).expect(404);
    await http().post(`/agency-offers/${offer.id}/accept`).set(as('emp')).expect(404);
    await http().post(`/agency-offers/${offer.id}/decline`).set(as('nosy')).expect(404);
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    const tx = async (tenant: string, fn: () => Promise<unknown>) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.actor_role', 'owner', true)`, [tenant]);
      try { await fn(); } finally { await c.query('rollback'); }
    };
    try {
      for (const other of [ids.nosy, ids.bayside, ids.metro]) {
        await tx(other, () => expect(c.query(`select * from app_agency_accept_offer($1)`, [offer.id])).rejects.toThrow(/Offer not found/));
        await tx(other, async () => expect((await c.query(`select count(*)::int as n from agency_offers`)).rows[0].n).toBe(0));
      }
      await tx(ids.cfy, () => expect(c.query(`delete from agency_offers`)).rejects.toThrow(/permission denied/));
      await tx(ids.cfy, () => expect(c.query(`insert into agency_offers(tenant_id, inbox_id, worker_id) values ($1, $2, $3)`, [ids.nosy, inboxId, people.Ana])).rejects.toThrow(/row-level security/));
    } finally {
      await c.end();
    }
    expect((await http().get(`/shifts/${s}`).set(as('emp')).expect(200)).body.status).toBe('open');
  });
});
