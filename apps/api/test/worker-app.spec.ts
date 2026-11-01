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
import { makeWords } from '../src/terms/words.js';
import {
  appAccessRefusal, appAccessState, appCredentialEmail, removeAccessRefusal, appLeaveEmail, myDateRefusal, myLeaveCancelRefusal, myLeaveRefusal, myShiftState, notLinkedMessage,
} from '../src/worker-app/worker-app.js';
import { NOTICE_VERSION, noticeRefusal, noticeState, noticeUrl } from '../src/worker-app/notice.js';
import { readFileSync } from 'node:fs';
import { withTenant } from '@crop/db';
import { Pool } from 'pg';
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
    expect(removeAccessRefusal({ state: 'none', memberRole: null, name: 'Ana Example' })).toBe("Ana Example doesn't have the app");
    expect(removeAccessRefusal({ state: 'active', memberRole: 'allocator', name: 'Ana Example' })).toMatch(/signs in to the office/);
    expect(removeAccessRefusal({ state: 'active', memberRole: 'worker', name: 'Ana Example' })).toBeNull();
    expect(removeAccessRefusal({ state: 'invited', memberRole: null, name: 'Ana Example' })).toBeNull();
    expect(notLinkedMessage('Demo Cafe')).toBe("Your sign-in isn't linked to anyone at Demo Cafe yet. Ask the office to give you access to the app.");
    expect(changeSummary({ kind: 'booked', workerName: 'Ana Example', equipmentName: null, detail: null, via: 'app' }))
      .toBe('Ana Example accepted the offer in the app and is booked');
  });

  it('works out when to show the worker privacy notice', () => {
    expect(noticeState(null)).toBe('new');
    expect(noticeState(NOTICE_VERSION)).toBe('seen');
    expect(noticeState('0.0 (old)')).toBe('changed');
    expect(noticeUrl('https://crop.test/')).toBe('https://crop.test/legal/worker-notice');
    expect(noticeUrl(undefined)).toBeNull();
    expect(noticeRefusal(NOTICE_VERSION)).toBeNull();
    expect(noticeRefusal(undefined)).toBe('Say which version of the notice you read');
    expect(noticeRefusal('0.0 (old)')).toMatch(/^The notice has changed/);
    // The version the app asks people to confirm is the one the web's legal pages show.
    const web = readFileSync(new URL('../../web/lib/legal/documents.ts', import.meta.url), 'utf8');
    expect(web).toContain(`LEGAL_VERSION = "Version ${NOTICE_VERSION}"`);
  });

  it('checks dates for availability and leave asked for in the app', () => {
    expect(myDateRefusal('2026-11-01', '2026-11-02')).toBe('Choose today or a later date');
    expect(myDateRefusal('2026-11-02', '2026-11-02')).toBeNull();
    expect(myDateRefusal('2028-01-01', '2026-11-02')).toBe('Choose a date within the next year');
    expect(myLeaveRefusal('2026-11-05', '2026-11-04', '2026-11-02')).toBe('The leave ends before it starts');
    expect(myLeaveRefusal('2026-11-01', '2026-11-04', '2026-11-02')).toMatch(/^Leave can start today at the earliest/);
    expect(myLeaveRefusal('2026-11-02', '2026-11-02', '2026-11-02')).toBeNull();
    expect(myLeaveRefusal('2026-11-03', '2028-01-01', '2026-11-02')).toBe('Leave can be at most a year at a time');
    expect(myLeaveCancelRefusal('requested')).toBeNull();
    expect(myLeaveCancelRefusal('approved')).toBe('This leave is approved. Contact the office to cancel it.');
    expect(myLeaveCancelRefusal('declined')).toBe('This leave is already declined');
  });

  it('words the emails to the office about leave and credentials from the app', () => {
    const one = appLeaveEmail({ name: 'Ana Example', workerId: 'w1', startsOn: '2026-11-09', endsOn: '2026-11-11', shiftsDuring: 1 }, 'https://crop.test/');
    expect(one.subject).toBe('Leave request from Ana Example: Mon 9 Nov to Wed 11 Nov');
    expect(one.body).toContain('1 shift of theirs falls in those days and will need cover if it is approved.');
    expect(one.body).toContain('open the Leave page: https://crop.test/leave');
    expect(one.body).not.toMatch(/annual|personal|note/i);
    const none = appLeaveEmail({ name: 'Ana Example', workerId: 'w1', startsOn: '2026-11-09', endsOn: '2026-11-09', shiftsDuring: 0 }, '');
    expect(none.subject).toBe('Leave request from Ana Example: Mon 9 Nov');
    expect(none.body).toContain('They have no shifts on the roster in those days.');
    expect(none.body).toContain('open the Leave page in CROP.');
    const jobs = makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }, { code: 1050, singular: 'Ticket', plural: 'Tickets' }]);
    expect(appLeaveEmail({ name: 'Ana', workerId: 'w1', startsOn: '2026-11-09', endsOn: '2026-11-10', shiftsDuring: 2 }, '', jobs).body)
      .toContain('2 jobs of theirs fall in those days');

    const c = appCredentialEmail({ name: 'Ana Example', workerId: 'w1', typeName: 'White Card', category: 'licence' }, 'https://crop.test', jobs);
    expect(c.subject).toBe('Ana Example added a ticket in the app');
    expect(c.body).toContain('Ana Example has added White Card in the CROP app.');
    expect(c.body).toContain('open their page: https://crop.test/workers/w1');
    const v = appCredentialEmail({ name: 'Ana Example', workerId: 'w1', typeName: 'Influenza Vaccination', category: 'vaccination' }, '');
    expect(v.subject).toBe('Ana Example added a vaccination record in the app');
    expect(`${v.subject}\n${v.body}`).not.toMatch(/influenza/i);
  });
});

const addDaysTo = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

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

  it('shows the worker privacy notice until they confirm reading it, and the office sees when', async () => {
    let me = (await http().get('/my').set(as('ana')).expect(200)).body;
    expect(me.notice).toMatchObject({ version: NOTICE_VERSION, state: 'new', acknowledgedAt: null });
    expect((await http().get(`/workers/${ana}/app-access`).set(as('alloc')).expect(200)).body.notice).toBeNull();
    expect((await http().post('/my/notice').set(as('ana')).send({}).expect(409)).body.message).toBe('Say which version of the notice you read');
    expect((await http().post('/my/notice').set(as('ana')).send({ version: 'old' }).expect(409)).body.message).toMatch(/has changed/);
    const r = await http().post('/my/notice').set(as('ana')).send({ version: NOTICE_VERSION }).expect(200);
    expect(r.body).toMatchObject({ state: 'seen', version: NOTICE_VERSION });
    expect(r.body.acknowledgedAt).toBeTruthy();
    // Again changes nothing.
    await http().post('/my/notice').set(as('ana')).send({ version: NOTICE_VERSION }).expect(200);
    expect((await owner.query('select count(*)::int as n from worker_notice_acknowledgements where worker_id = $1', [ana])).rows[0].n).toBe(1);
    me = (await http().get('/my').set(as('ana')).expect(200)).body;
    expect(me.notice.state).toBe('seen');
    const office = (await http().get(`/workers/${ana}/app-access`).set(as('alloc')).expect(200)).body.notice;
    expect(office).toMatchObject({ version: NOTICE_VERSION, current: true });
    // An older version confirmed earlier means the new one is shown again.
    await owner.query(`update worker_notice_acknowledgements set notice_version = '0.0 (old)' where worker_id = $1`, [ana]);
    expect((await http().get('/my').set(as('ana')).expect(200)).body.notice.state).toBe('changed');
    expect((await http().get(`/workers/${ana}/app-access`).set(as('alloc')).expect(200)).body.notice.current).toBe(false);
    await http().post('/my/notice').set(as('ana')).send({ version: NOTICE_VERSION }).expect(200);
    // Office accounts that aren't anyone on the roster have nothing to confirm.
    await http().post('/my/notice').set(as('alloc')).send({ version: NOTICE_VERSION }).expect(404);
    // The record can't be changed or removed by the app, and another business sees none of it.
    const pool = new Pool({ connectionString: db.appUrl });
    try {
      const cafe = (await owner.query(`select id from tenants where slug = 'cafe'`)).rows[0].id;
      const other = (await owner.query(`select id from tenants where slug = 'other'`)).rows[0].id;
      await expect(withTenant(pool, cafe, c => c.query('delete from worker_notice_acknowledgements'))).rejects.toThrow(/permission denied/);
      await expect(withTenant(pool, cafe, c => c.query(`update worker_notice_acknowledgements set notice_version = 'x'`))).rejects.toThrow(/permission denied/);
      expect(await withTenant(pool, other, async c => (await c.query('select * from worker_notice_acknowledgements')).rowCount)).toBe(0);
      await expect(withTenant(pool, other, c => c.query(
        `insert into worker_notice_acknowledgements(tenant_id, worker_id, notice_version) values ($1, $2, 'x')`, [cafe, ana]))).rejects.toThrow(/row-level security/);
    } finally {
      await pool.end();
    }
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

  it('lets them set their usual week and changes for particular dates, which the office and eligibility see', async () => {
    const empty = (await http().get('/my/availability').set(as('ana')).expect(200)).body;
    expect(empty).toMatchObject({ pattern: [], dates: [], leave: [] });
    expect(empty.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Not on Mondays at all, Tuesdays mornings only.
    await http().put('/my/availability/pattern').set(as('ana')).send({ days: [{ weekday: 1, periods: [] }, { weekday: 2, periods: ['am'] }] }).expect(200);
    const bad = await http().put('/my/availability/pattern').set(as('ana')).send({ days: [{ weekday: 8, periods: [] }] }).expect(400);
    expect(bad.body.message).toBe('Each day needs a weekday from 1 (Monday) to 7 (Sunday)');
    const office = (await http().get(`/workers/${ana}/availability`).set(as('alloc')).expect(200)).body;
    expect(office.pattern).toEqual([{ weekday: 1, periods: [] }, { weekday: 2, periods: ['am'] }]);

    const monday = ahead(5);
    const s = await shift(monday);
    let ready = (await http().get(`/shifts/${s}/candidates`).set(as('alloc')).expect(200)).body;
    const anaRow = (rows: { workerId?: string; id?: string; warnings: { code: string }[] }[]) => rows.find(r => (r.workerId ?? r.id) === ana)!;
    const list = (b: unknown) => (Array.isArray(b) ? b : (b as { candidates: [] }).candidates);
    expect(anaRow(list(ready)).warnings.map(w => w.code)).toContain('availability');
    // A change for that Monday: free all day.
    const d = await http().put(`/my/availability/dates/${monday}`).set(as('ana')).send({ periods: ['am', 'pm', 'night'], note: 'Swapped with my sister' }).expect(200);
    expect(d.body).toEqual({ date: monday, periods: ['am', 'pm', 'night'], note: 'Swapped with my sister' });
    ready = (await http().get(`/shifts/${s}/candidates`).set(as('alloc')).expect(200)).body;
    expect(anaRow(list(ready)).warnings.map(w => w.code)).not.toContain('availability');
    expect((await http().get('/my/availability').set(as('ana')).expect(200)).body.dates).toEqual([d.body]);
    await http().delete(`/my/availability/dates/${monday}`).set(as('ana')).expect(204);
    expect((await http().get('/my/availability').set(as('ana')).expect(200)).body.dates).toEqual([]);
    // Days already gone can't be changed.
    const past = await http().put('/my/availability/dates/2026-01-05').set(as('ana')).send({ periods: [] }).expect(400);
    expect(past.body.message).toBe('Choose today or a later date');
    // Someone not linked to a person has nothing to set.
    await http().put('/my/availability/pattern').set(as('alloc')).send({ days: [] }).expect(404);
    await http().put('/my/availability/pattern').set(as('ana')).send({ days: [] }).expect(200);
  });

  it('lets them ask for leave, which waits for an owner or admin, and withdraw it while it waits', async () => {
    const start = ahead(6);
    const s = await shift(addDaysTo(start, 1));
    await http().post(`/shifts/${s}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    const asked = await http().post('/my/leave').set(as('ana')).send({ kind: 'annual', startsOn: start, endsOn: addDaysTo(start, 2), note: 'Family wedding' }).expect(201);
    expect(asked.body).toMatchObject({ kind: 'annual', startsOn: start, endsOn: addDaysTo(start, 2), days: 3, status: 'requested', shiftsDuring: 1 });
    expect(asked.body.workerName).toBeUndefined();
    // Owners and admins (not allocators) get an email, without the kind of leave or the note.
    const told = (await owner.query(`select to_address as to, template, subject, body from notifications where template = 'app_leave_request'`)).rows;
    expect(told.map(n => n.to)).toEqual(['admin@x.com']);
    expect(told[0].body).toContain('Ana Example has asked for leave in the CROP app');
    expect(told[0].body).toContain('1 shift of theirs falls in those days');
    expect(`${told[0].subject} ${told[0].body}`).not.toMatch(/annual|wedding/i);
    // Even an "approved" flag can't approve it.
    const again = await http().post('/my/leave').set(as('ana')).send({ kind: 'annual', startsOn: start, endsOn: start, approved: true }).expect(409);
    expect(again.body.message).toBe('You already have leave on some of those days');
    const past = await http().post('/my/leave').set(as('ana')).send({ kind: 'personal', startsOn: '2026-01-05', endsOn: '2026-01-06' }).expect(400);
    expect(past.body.message).toMatch(/^Leave can start today at the earliest/);
    // The office sees the request; the shift now warns.
    const waiting = (await http().get('/leave?status=requested').set(as('alloc')).expect(200)).body;
    expect(waiting.map((l: { id: string; workerName: string }) => [l.id, l.workerName])).toEqual([[asked.body.id, 'Ana Example']]);
    const mine = (await http().get('/my/availability').set(as('ana')).expect(200)).body.leave;
    expect(mine.map((l: { id: string; status: string }) => [l.id, l.status])).toEqual([[asked.body.id, 'requested']]);
    // Ben can't withdraw Ana's leave; Ana can while it waits.
    await http().post(`/my/leave/${asked.body.id}/cancel`).set(as('ben')).expect(404);
    const gone = await http().post(`/my/leave/${asked.body.id}/cancel`).set(as('ana')).expect(200);
    expect(gone.body.status).toBe('cancelled');
    expect((await http().get('/my/availability').set(as('ana')).expect(200)).body.leave).toEqual([]);
    // Once approved, only the office can cancel it.
    const next = await http().post('/my/leave').set(as('ana')).send({ kind: 'other', startsOn: start, endsOn: start }).expect(201);
    await http().post(`/leave/${next.body.id}/approve`).set(as('admin')).expect(200);
    const refused = await http().post(`/my/leave/${next.body.id}/cancel`).set(as('ana')).expect(409);
    expect(refused.body.message).toBe('This leave is approved. Contact the office to cancel it.');
    expect((await http().get('/my/availability').set(as('ana')).expect(200)).body.leave.map((l: { status: string }) => l.status)).toEqual(['approved']);
    // Another business's worker account can't reach it.
    await http().post(`/my/leave/${next.body.id}/cancel`).set(as('other')).expect(404);
  });

  it('lets owners and admins take the app away and give it back', async () => {
    await http().get('/my').set(as('ben')).expect(200);
    await http().post(`/workers/${ben}/app-access/remove`).set(as('alloc')).expect(403);
    await http().post(`/workers/${ben}/app-access/remove`).set(as('other')).expect(404);
    const r = await http().post(`/workers/${ben}/app-access/remove`).set(as('admin')).expect(200);
    expect(r.body).toMatchObject({ state: 'none', email: 'ben@example.com', refusal: null });
    expect(r.body).not.toHaveProperty('userId');
    // The app stops working for them straight away; their record stays.
    await http().get('/my').set(as('ben')).expect(403);
    expect((await owner.query('select user_id, status from workers where id = $1', [ben])).rows[0]).toEqual({ user_id: null, status: 'active' });
    expect((await owner.query(`select action, via from audit_log where table_name = 'memberships' and action = 'delete'`)).rows).toEqual([{ action: 'delete', via: 'office' }]);
    expect((await http().post(`/workers/${ben}/app-access/remove`).set(as('admin')).expect(409)).body.message).toBe("Ben Example doesn't have the app");
    // An invitation still waiting can be cancelled the same way.
    expect((await http().post(`/workers/${ben}/app-access`).set(as('admin')).expect(201)).body.state).toBe('invited');
    expect((await http().post(`/workers/${ben}/app-access/remove`).set(as('admin')).expect(200)).body.state).toBe('none');
    expect((await owner.query(`select count(*)::int as n from invitations where worker_id = $1 and accepted_at is null`, [ben])).rows[0].n).toBe(0);
    await http().get('/my').set(as('ben')).expect(403);
    // Given again, they get back in and see their own record.
    await http().post(`/workers/${ben}/app-access`).set(as('admin')).expect(201);
    expect((await http().get('/my').set(as('ben')).expect(200)).body).toMatchObject({ name: 'Ben Example' });
    expect((await http().get(`/workers/${ben}/app-access`).set(as('alloc')).expect(200)).body.state).toBe('active');
  });
});
