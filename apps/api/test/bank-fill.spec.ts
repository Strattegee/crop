import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { offerMessage, offerState, shiftLabel } from '../src/roster/bank-fill.js';
import { startFakeIdp } from './fake-idp.js';

describe('bank fill: pure helpers', () => {
  const s = { role: 'Chef', localDate: '2026-11-02', localStart: '07:00', localEnd: '15:30', facilityName: 'Harbour Kitchen', areaName: 'Kitchen' };
  it('describes the shift and the offer in plain words', () => {
    expect(shiftLabel(s)).toBe('Mon 2 Nov, 07:00–15:30, Chef at Harbour Kitchen (Kitchen)');
    const m = offerMessage('Ana', 'Demo Cafe', { ...s, areaName: null }, '3:30 pm Mon 2 Nov');
    expect(m.sms).toBe('Hi Ana, Demo Cafe has a shift for you: Mon 2 Nov, 07:00–15:30, Chef at Harbour Kitchen. Contact Demo Cafe if you\'d like it; the first to accept gets it. The offer is open until 3:30 pm Mon 2 Nov.');
    expect(m.subject).toBe('Shift available: Mon 2 Nov 07:00–15:30');
  });
  it('shows a pending offer past its time as expired', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(offerState('pending', new Date('2026-10-31T23:59:00Z'), now)).toBe('expired');
    expect(offerState('pending', new Date('2026-11-01T00:01:00Z'), now)).toBe('pending');
    expect(offerState('pending', null, now)).toBe('pending');
    expect(offerState('declined', new Date('2026-10-01T00:00:00Z'), now)).toBe('declined');
  });
});

describe('bank fill: offers, first to accept is booked', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, area: string;
  let ana: string, ben: string, cal: string, dee: string;

  const shift = async (date: string, startTime = '07:00', endTime = '15:30', extra: Record<string, unknown> = {}) =>
    (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, areaId: area, role: 'Chef', date, startTime, endTime, ...extra }).expect(201)).body.ids[0] as string;
  const messages = async (template: string) =>
    (await owner.query<{ channel: string; to_address: string; body: string }>(
      'select channel, to_address, body from notifications where template = $1 order by channel, to_address', [template])).rows;

  beforeAll(async () => {
    db = await createTestDatabase('crop_bank_fill');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`, [id('cafe'), id('other')]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    site = (await http().post('/facilities').set(as('admin')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    area = (await http().post(`/facilities/${site}/areas`).set(as('admin')).send({ name: 'Kitchen' }).expect(201)).body.id;
    const person = async (firstName: string, roles: string[], type: string, contact: Record<string, string>) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles, ...contact }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      await http().post(`/workers/${w}/employment`).set(as('admin')).send({ employmentType: type, startsOn: '2026-01-01' }).expect(201);
      return w;
    };
    ana = await person('Ana', ['Chef'], 'bank', { email: 'ana@example.com', phone: '0491 570 156' });
    ben = await person('Ben', ['Chef'], 'casual', { email: 'ben@example.com' });
    cal = await person('Cal', ['Chef'], 'full_time', { email: 'cal@example.com' });
    dee = await person('Dee', ['Barista'], 'bank', { phone: '0491 570 157' });
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lists bank and casual staff for an open shift, ready first', async () => {
    const s = await shift('2026-11-02');
    const r = await http().get(`/shifts/${s}/bank-fill`).set(as('alloc')).expect(200);
    expect(r.body.candidates.map((c: { name: string; eligible: boolean }) => [c.name, c.eligible])).toEqual([
      ['Ana Example', true], ['Ben Example', true], ['Dee Example', false],
    ]);
    expect(r.body.candidates[0].offer).toBeNull();
    const all = await http().get(`/shifts/${s}/bank-fill?everyone=true`).set(as('alloc')).expect(200);
    expect(all.body.candidates.map((c: { name: string }) => c.name)).toContain('Cal Example');
    await http().get(`/shifts/${s}/bank-fill`).set(as('worker')).expect(403);
  });

  it('offers to several, messages them, and books the first to accept', async () => {
    const s = await shift('2026-11-03');
    // Someone who isn't eligible can't be offered it.
    const no = await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [ana, dee] }).expect(409);
    expect(no.body.message).toBe('Dee Example doesn\'t have the role Chef');
    await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [] }).expect(400);

    const o = await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [ana, ben] }).expect(201);
    expect(o.body).toMatchObject({ offered: 2, alreadyOffered: 0, messages: 3 });
    const again = await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [ana] }).expect(201);
    expect(again.body).toMatchObject({ offered: 0, alreadyOffered: 1, messages: 0 });
    const sent = await messages('shift_offer');
    expect(sent.map(m => [m.channel, m.to_address])).toEqual([['email', 'ana@example.com'], ['email', 'ben@example.com'], ['sms', '+61491570156']]);
    expect(sent[2].body).toContain('Tue 3 Nov, 07:00–15:30, Chef at Harbour Kitchen (Kitchen)');

    const list = (await http().get(`/shifts/${s}/bank-fill`).set(as('alloc')).expect(200)).body;
    expect(list.candidates.find((c: { workerId: string }) => c.workerId === ana).offer.status).toBe('pending');
    const anaOffer = list.offers.find((x: { workerId: string }) => x.workerId === ana).id;
    const benOffer = list.offers.find((x: { workerId: string }) => x.workerId === ben).id;

    // Both say yes at the same moment: only one is booked.
    const [a, b] = await Promise.all([
      http().post(`/offers/${benOffer}/accept`).set(as('alloc')),
      http().post(`/offers/${anaOffer}/accept`).set(as('alloc')),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = a.status === 200 ? a : b;
    const lost = a.status === 200 ? b : a;
    expect(lost.body.message).toBe('This shift has already been filled');
    expect(won.body).toMatchObject({ status: 'booked', assignmentStatus: 'confirmed' });
    expect(won.body.offers.map((x: { status: string }) => x.status).sort()).toEqual(['accepted', 'filled']);
    expect((await messages('shift_booked')).length).toBeGreaterThan(0);
    expect((await messages('shift_filled')).length).toBe(1);

    await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [cal] }).expect(409); // already filled
  });

  it('records a decline, expires offers and withdraws them', async () => {
    const s = await shift('2026-11-04');
    const o = (await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [ana, ben], notify: false, expiresInMinutes: 30 }).expect(201)).body;
    expect(o.messages).toBe(0);
    const anaOffer = o.offers.find((x: { workerId: string }) => x.workerId === ana).id;
    const benOffer = o.offers.find((x: { workerId: string }) => x.workerId === ben).id;
    await http().post(`/offers/${anaOffer}/decline`).set(as('alloc')).expect(200);
    await http().post(`/offers/${anaOffer}/decline`).set(as('alloc')).expect(409);
    await http().post(`/offers/${anaOffer}/accept`).set(as('alloc')).expect(409);

    await owner.query(`update shift_offers set expires_at = now() - interval '1 minute' where id = $1`, [benOffer]);
    const exp = await http().post(`/offers/${benOffer}/accept`).set(as('alloc')).expect(409);
    expect(exp.body.message).toMatch(/expired/);
    expect((await http().get(`/shifts/${s}/offers`).set(as('alloc')).expect(200)).body.find((x: { id: string }) => x.id === benOffer).status).toBe('expired');
    // Offering again closes the expired one and asks afresh.
    const again = (await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [ben], notify: false }).expect(201)).body;
    expect(again.offered).toBe(1);
    const w = await http().post(`/shifts/${s}/offers/withdraw`).set(as('alloc')).expect(200);
    expect(w.body.withdrawn).toBe(1);
  });

  it('closes offers when the shift is filled directly or cancelled', async () => {
    const s1 = await shift('2026-11-05');
    await http().post(`/shifts/${s1}/offers`).set(as('alloc')).send({ workerIds: [ana, ben], notify: false }).expect(201);
    await http().post(`/shifts/${s1}/assign`).set(as('alloc')).send({ workerId: cal }).expect(200);
    expect((await http().get(`/shifts/${s1}/offers`).set(as('alloc')).expect(200)).body.map((x: { status: string }) => x.status)).toEqual(['filled', 'filled']);

    const s2 = await shift('2026-11-06');
    const o = (await http().post(`/shifts/${s2}/offers`).set(as('alloc')).send({ workerIds: [ana], notify: false }).expect(201)).body.offers[0].id;
    await http().post(`/shifts/${s2}/cancel`).set(as('alloc')).send({ reason: 'Closed' }).expect(200);
    expect((await http().get(`/shifts/${s2}/offers`).set(as('alloc')).expect(200)).body[0].status).toBe('withdrawn');
    expect((await http().post(`/offers/${o}/accept`).set(as('alloc')).expect(409)).body.message).toBe('This shift is cancelled');
    await http().post(`/shifts/${s2}/offers`).set(as('alloc')).send({ workerIds: [ana] }).expect(409);
  });

  it('refuses an acceptance that would double book the person', async () => {
    const a = await shift('2026-11-09', '07:00', '15:00');
    const b = await shift('2026-11-09', '12:00', '20:00');
    const oa = (await http().post(`/shifts/${a}/offers`).set(as('alloc')).send({ workerIds: [ana], notify: false }).expect(201)).body.offers[0].id;
    const ob = (await http().post(`/shifts/${b}/offers`).set(as('alloc')).send({ workerIds: [ana], notify: false }).expect(201)).body.offers[0].id;
    const [r1, r2] = await Promise.all([http().post(`/offers/${oa}/accept`).set(as('alloc')), http().post(`/offers/${ob}/accept`).set(as('alloc'))]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect((r1.status === 409 ? r1 : r2).body.message).toMatch(/Ana Example is already rostered/);
  });

  it('skips equipment-only shifts', async () => {
    const s = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, equipmentOnly: true, date: '2026-11-10', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
    expect((await http().get(`/shifts/${s}/bank-fill`).set(as('alloc')).expect(200)).body.candidates).toEqual([]);
    await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [ana] }).expect(409);
  });

  it('keeps offers to the business and never deletes them', async () => {
    const s = await shift('2026-11-11');
    const o = (await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [ana], notify: false }).expect(201)).body.offers[0].id;
    await http().get(`/shifts/${s}/bank-fill`).set(as('other')).expect(404);
    await http().post(`/offers/${o}/accept`).set(as('other')).expect(404);
    await http().post(`/offers/${o}/decline`).set(as('other')).expect(404);
    const appDb = new Client({ connectionString: db.appUrl });
    await appDb.connect();
    try {
      expect((await appDb.query('select * from shift_offers')).rowCount).toBe(0); // no tenant set: row-level security hides everything
      await expect(appDb.query('delete from shift_offers')).rejects.toThrow(/permission denied/);
    } finally {
      await appDb.end();
    }
  });
});
