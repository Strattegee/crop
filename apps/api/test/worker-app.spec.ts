import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { changeSummary } from '../src/roster/publishing.js';
import { appAccessRefusal, appAccessState, myShiftState, notLinkedMessage } from '../src/worker-app/worker-app.js';
import { startFakeIdp } from './fake-idp.js';

describe('worker app: pure rules', () => {
  it('works out app access and how a shift shows', () => {
    expect(appAccessState({ member: true, pendingInvite: true })).toBe('active');
    expect(appAccessState({ member: false, pendingInvite: true })).toBe('invited');
    expect(appAccessState({ member: false, pendingInvite: false })).toBe('none');
    expect(myShiftState('confirmed')).toBe('booked');
    expect(myShiftState('assigned')).toBe('to_confirm');
    expect(appAccessRefusal({ status: 'active', email: null, name: 'Ana Example' })).toBe('Add an email address for Ana Example first: they sign in with it');
    expect(appAccessRefusal({ status: 'agency', email: 'a@example.com', name: 'Ana Example' })).toMatch(/agency/);
    expect(appAccessRefusal({ status: 'active', email: 'a@example.com', name: 'Ana Example' })).toBeNull();
    expect(notLinkedMessage('Demo Cafe')).toBe("Your sign-in isn't linked to anyone at Demo Cafe yet. Ask the office to give you access to the app.");
    expect(changeSummary({ kind: 'booked', workerName: 'Ana Example', equipmentName: null, detail: null, via: 'app' }))
      .toBe('Ana Example accepted the offer in the app and is booked');
  });
});

/** The Monday at least a week ahead, plus `weeks` weeks, plus `day` days (YYYY-MM-DD). */
function ahead(weeks: number, day = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7 + ((8 - d.getUTCDay()) % 7) + weeks * 7 + day);
  return d.toISOString().slice(0, 10);
}

describe('worker app: access, my shifts and offers', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, area: string;
  let ana: string, ben: string, noEmail: string;
  const range = `from=${ahead(0)}&to=${ahead(4)}`;

  const shift = async (date: string, startTime = '07:00', endTime = '15:00') =>
    (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, areaId: area, role: 'Chef', date, startTime, endTime }).expect(201)).body.ids[0] as string;
  const signIn = async (sub: string, email: string, verified = true) => {
    idp.addUser({ sub, email, email_verified: verified, name: sub });
    tok[sub] = await idp.token(sub, { expiresIn: '1h' });
  };

  beforeAll(async () => {
    db = await createTestDatabase('crop_worker_app');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [id('cafe'), id('other')]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['other', 'o@x.com']]) await signIn(sub, email);
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    site = (await http().post('/facilities').set(as('admin')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    area = (await http().post(`/facilities/${site}/areas`).set(as('admin')).send({ name: 'Kitchen' }).expect(201)).body.id;
    const person = async (firstName: string, contact: Record<string, string>) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Chef'], ...contact }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      await http().post(`/workers/${w}/employment`).set(as('admin')).send({ employmentType: 'casual', startsOn: '2026-01-01' }).expect(201);
      return w;
    };
    ana = await person('Ana', { email: 'ana@example.com' });
    ben = await person('Ben', { email: 'ben@example.com' });
    noEmail = await person('Cal', {});
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lets owners and admins give someone the app by inviting their email', async () => {
    const before = await http().get(`/workers/${ana}/app-access`).set(as('alloc')).expect(200);
    expect(before.body).toMatchObject({ state: 'none', email: 'ana@example.com', refusal: null });
    await http().post(`/workers/${ana}/app-access`).set(as('alloc')).expect(403);
    const cal = await http().post(`/workers/${noEmail}/app-access`).set(as('admin')).expect(409);
    expect(cal.body.message).toBe('Add an email address for Cal Example first: they sign in with it');
    const r = await http().post(`/workers/${ana}/app-access`).set(as('admin')).expect(201);
    expect(r.body).toMatchObject({ state: 'invited', email: 'ana@example.com' });
    // Pressing it again changes nothing.
    await http().post(`/workers/${ana}/app-access`).set(as('admin')).expect(201);
    expect((await owner.query(`select role, worker_id from invitations where email = 'ana@example.com'`)).rows).toEqual([{ role: 'worker', worker_id: ana }]);
    // Another business can't see or give access to this person.
    await http().get(`/workers/${ana}/app-access`).set(as('other')).expect(404);
    await http().post(`/workers/${ana}/app-access`).set(as('other')).expect(404);
  });

  it('gets them in only once the identity provider has verified the email, and links them to their record', async () => {
    await signIn('ana', 'ana@example.com', false);
    await http().get('/my').set(as('ana')).expect(403);
    await signIn('ana', 'ana@example.com', true);
    const me = await http().get('/my').set(as('ana')).expect(200);
    expect(me.body).toMatchObject({ business: 'Demo Cafe', firstName: 'Ana', name: 'Ana Example', word: { one: 'Shift', lower: 'shift' } });
    expect((await owner.query('select user_id is not null as linked from workers where id = $1', [ana])).rows[0].linked).toBe(true);
    expect((await http().get(`/workers/${ana}/app-access`).set(as('alloc')).expect(200)).body).toMatchObject({ state: 'active' });
    expect((await http().post(`/workers/${ana}/app-access`).set(as('admin')).expect(409)).body.message).toBe('Ana Example already has the app');
    // The worker role can't reach office screens.
    await http().get('/workers').set(as('ana')).expect(403);
    await http().get(`/workers/${ana}/app-access`).set(as('ana')).expect(403);
  });

  it('tells an office account that is nobody on the roster to ask for access', async () => {
    const r = await http().get('/my/shifts').set(as('alloc')).expect(404);
    expect(r.body.message).toBe("Your sign-in isn't linked to anyone at Demo Cafe yet. Ask the office to give you access to the app.");
  });

  it('shows their shifts in published weeks only, booked or to confirm', async () => {
    const s1 = await shift(ahead(0, 1));
    await http().post(`/shifts/${s1}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    const s2 = await shift(ahead(1, 2), '18:00', '23:00');
    await http().post(`/shifts/${s2}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    const other = await shift(ahead(0, 3));
    await http().post(`/shifts/${other}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);

    expect((await http().get(`/my/shifts?${range}`).set(as('ana')).expect(200)).body.shifts).toEqual([]);
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: ahead(0), facilityId: site, notify: false }).expect(201);
    let mine = (await http().get(`/my/shifts?${range}`).set(as('ana')).expect(200)).body.shifts;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: s1, date: ahead(0, 1), start: '07:00', end: '15:00', site: 'Harbour Kitchen', area: 'Kitchen', role: 'Chef', state: 'to_confirm', duties: [] });
    expect(mine[0].label).toContain('07:00–15:00, Chef at Harbour Kitchen (Kitchen)');
    await http().post(`/shifts/${s1}/confirm`).set(as('alloc')).expect(200);
    mine = (await http().get(`/my/shifts?${range}`).set(as('ana')).expect(200)).body.shifts;
    expect(mine[0].state).toBe('booked');
    // Cancelled shifts drop off.
    await http().post(`/shifts/${s1}/cancel`).set(as('alloc')).send({ reason: 'Closed' }).expect(200);
    expect((await http().get(`/my/shifts?${range}`).set(as('ana')).expect(200)).body.shifts).toEqual([]);
    await http().get('/my/shifts?from=2026-01-01&to=2026-12-31').set(as('ana')).expect(400);
    await http().get('/my/shifts?from=2026-02-01&to=2026-01-01').set(as('ana')).expect(400);
  });

  it('lists their offers and lets them accept or decline in the app', async () => {
    const s = await shift(ahead(2, 0));
    const t = await shift(ahead(2, 1));
    await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [ana, ben], notify: false }).expect(201);
    await http().post(`/shifts/${t}/offers`).set(as('alloc')).send({ workerIds: [ana, ben], notify: false }).expect(201);
    const offers = (await http().get('/my/offers').set(as('ana')).expect(200)).body.offers;
    expect(offers.map((o: { shift: { id: string } }) => o.shift.id)).toEqual([s, t]);
    expect(offers[0].shift).toMatchObject({ role: 'Chef', site: 'Harbour Kitchen', start: '07:00' });

    // Ben's offer isn't Ana's to answer.
    const benOffer = (await owner.query<{ id: string }>('select id from shift_offers where shift_id = $1 and worker_id = $2', [s, ben])).rows[0].id;
    await http().post(`/my/offers/${benOffer}/accept`).set(as('ana')).expect(404);

    const yes = await http().post(`/my/offers/${offers[0].id}/accept`).set(as('ana')).expect(200);
    expect(yes.body).toMatchObject({ status: 'accepted', shiftId: s });
    expect((await owner.query('select status, responded_via, responded_by is not null as by from shift_offers where id = $1', [offers[0].id])).rows[0])
      .toEqual({ status: 'accepted', responded_via: 'app', by: true });
    const again = await http().post(`/my/offers/${offers[0].id}/accept`).set(as('ana')).expect(409);
    expect(again.body.message).toBe("You've already accepted this shift");
    // The week isn't published, but a shift they accepted shows.
    const mine = (await http().get(`/my/shifts?from=${ahead(2)}&to=${ahead(2, 6)}`).set(as('ana')).expect(200)).body.shifts;
    expect(mine.map((m: { id: string; state: string }) => [m.id, m.state])).toEqual([[s, 'booked']]);
    const history = (await http().get(`/shifts/${s}/history`).set(as('alloc')).expect(200)).body;
    const rows = Array.isArray(history) ? history : history.changes;
    expect(rows.some((c: { summary: string; via: string }) => c.via === 'app' && c.summary === 'Ana Example accepted the offer in the app and is booked')).toBe(true);

    const no = await http().post(`/my/offers/${offers[1].id}/decline`).set(as('ana')).expect(200);
    expect(no.body).toMatchObject({ status: 'declined', shiftId: t });
    expect((await http().get('/my/offers').set(as('ana')).expect(200)).body.offers).toEqual([]);
    // Ben's offer for the filled shift closed; his other is still open.
    await signIn('ben', 'ben@example.com');
    await http().post(`/workers/${ben}/app-access`).set(as('admin')).expect(201);
    const benOffers = (await http().get('/my/offers').set(as('ben')).expect(200)).body.offers;
    expect(benOffers.map((o: { shift: { id: string } }) => o.shift.id)).toEqual([t]);
  });

  it('applies the after-publishing lock to replies in the app', async () => {
    const s = await shift(ahead(3, 0));
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: ahead(3), facilityId: site, notify: false }).expect(201);
    await http().post(`/shifts/${s}/offers`).set(as('alloc')).send({ workerIds: [ana], notify: false }).expect(201);
    await http().patch('/settings').set(as('admin')).send({ publishedChanges: 'locked' }).expect(200);
    const offer = (await http().get('/my/offers').set(as('ana')).expect(200)).body.offers.find((o: { shift: { id: string } }) => o.shift.id === s);
    const r = await http().post(`/my/offers/${offer.id}/accept`).set(as('ana')).expect(409);
    expect(r.body.message).toBe("This roster can't be changed now. Please contact the office.");
    await http().patch('/settings').set(as('admin')).send({ publishedChanges: 'open' }).expect(200);
  });
});
