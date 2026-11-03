import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { withTenant } from '@crop/db';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { NotificationDispatcher } from '../src/notifications/dispatcher.js';
import { PUSH_BODY_MAX, PUSH_OFF, pushScreen, pushText, pushTokenProblem } from '../src/notifications/push.js';
import { ExpiryReminders } from '../src/notifications/reminders.js';
import { MemoryPush, PUSH_SENDER, pushFromEnv } from '../src/notifications/senders.js';
import { bookedMessage, offerMessage } from '../src/roster/bank-fill.js';
import { addDays } from '../src/workforce/compliance.js';
import { rosterMessage } from '../src/roster/publishing.js';
import { makeWords } from '../src/terms/words.js';
import { startFakeIdp } from './fake-idp.js';

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

describe('push: pure rules and wording', () => {
  it('accepts only Expo push tokens', () => {
    expect(pushTokenProblem(TOKEN_A)).toBeNull();
    expect(pushTokenProblem(TOKEN_B)).toBeNull();
    expect(pushTokenProblem('abc')).toMatch(/does not recognise/);
    expect(pushTokenProblem('ExponentPushToken[]')).not.toBeNull();
    expect(pushTokenProblem('ExponentPushToken[aaaaaaaaaaaa] extra')).not.toBeNull();
  });

  it('keeps push text to one short line each', () => {
    const t = pushText('  Shift\navailable ', 'x'.repeat(300));
    expect(t.title).toBe('Shift available');
    expect(t.body).toHaveLength(PUSH_BODY_MAX);
    expect(t.body.endsWith('…')).toBe(true);
    expect(pushText('a', 'short').body).toBe('short');
  });

  it('words offers and published rosters for the app, in the business words', () => {
    const shift = { localDate: '2026-11-09', localStart: '07:00', localEnd: '15:00', role: 'Chef', facilityName: 'Harbour Kitchen', areaName: 'Kitchen' };
    const jobs = makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }]);
    const o = offerMessage('Ana', 'Demo Cafe', shift as never, null, 'https://crop.test/offer/x', jobs);
    expect(o.push.title).toBe(o.subject);
    expect(o.push.body).toMatch(/^Demo Cafe has a job for you: .*Open CROP to accept or decline\.$/);
    expect(o.push.body).not.toContain('https://');
    const r = rosterMessage({ first: 'Ana', business: 'Demo Cafe', site: 'Harbour Kitchen', weekStart: '2026-11-09', updated: false,
      shifts: [{ localDate: '2026-11-09', localStart: '07:00', localEnd: '15:00', role: 'Chef', areaName: null, confirmed: true }] as never }, jobs);
    expect(r.push).toEqual({ title: 'Your jobs at Harbour Kitchen for the week of Mon 9 Nov', body: 'Mon 9 7:00-15:00. Open CROP to see them.' });
    const none = rosterMessage({ first: 'Ana', business: 'Demo Cafe', site: 'Harbour Kitchen', weekStart: '2026-11-09', updated: true, shifts: [] });
    expect(none.push.body).toBe('You no longer have any shifts at Harbour Kitchen that week.');
  });

  it('opens the right screen of the app when tapped', () => {
    expect(pushScreen('shift_offer')).toBe('offers');
    expect(pushScreen('shift_booked')).toBe('shifts');
    expect(pushScreen('roster_published')).toBe('shifts');
    expect(pushScreen('shift_swap_asked')).toBe('shifts');
    expect(pushScreen('credential_expiry')).toBe('credentials');
    expect(pushScreen('welcome')).toBeNull();
  });

  it('words a booking for the app', () => {
    const shift = { localDate: '2026-11-09', localStart: '07:00', localEnd: '15:00', role: 'Chef', facilityName: 'Harbour Kitchen', areaName: null };
    const b = bookedMessage('Ana', 'Demo Cafe', shift as never, makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }]));
    expect(b.push).toEqual({ title: "You're booked: Mon 9 Nov 07:00–15:00", body: 'Demo Cafe: Mon 9 Nov, 07:00–15:00, Chef at Harbour Kitchen. Open CROP to see your jobs.' });
  });

  it('stays off until switched on', () => {
    const before = { ...process.env };
    try {
      delete process.env.NOTIFY_PROVIDERS;
      delete process.env.PUSH_SEND;
      expect(pushFromEnv().configured).toBe(false);
      process.env.PUSH_SEND = 'on';
      expect(pushFromEnv().configured).toBe(true);
    } finally {
      process.env = before;
    }
  });
});

/** The Monday at least a week ahead, plus `day` days (YYYY-MM-DD). */
function ahead(day = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7 + ((8 - d.getUTCDay()) % 7) + day);
  return d.toISOString().slice(0, 10);
}

describe('push: phones, queueing and sending', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let dispatcher: NotificationDispatcher;
  const push = new MemoryPush();
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, area: string, ana: string, cafe: string, other: string;

  const signIn = async (sub: string, email: string) => {
    idp.addUser({ sub, email, email_verified: true, name: sub });
    tok[sub] = await idp.token(sub, { expiresIn: '1h' });
  };
  const pushRows = async () => (await owner.query<{ to_address: string; template: string; subject: string; body: string; status: string; last_error: string | null }>(
    `select to_address, template, subject, body, status, last_error from notifications where channel = 'push' order by created_at, to_address`)).rows;
  const devices = async () => (await owner.query<{ token: string; removed_reason: string | null; live: boolean }>(
    `select token, removed_reason, removed_at is null as live from push_devices order by created_at, token`)).rows;

  beforeAll(async () => {
    db = await createTestDatabase('crop_push');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    cafe = t.rows.find(r => r.slug === 'cafe')!.id;
    other = t.rows.find(r => r.slug === 'other')!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [cafe, other]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['other', 'o@x.com']]) await signIn(sub, email);
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PUSH_SENDER).useValue(push).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    dispatcher = app.get(NotificationDispatcher);

    site = (await http().post('/facilities').set(as('admin')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    area = (await http().post(`/facilities/${site}/areas`).set(as('admin')).send({ name: 'Kitchen' }).expect(201)).body.id;
    ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Chef'], email: 'ana@example.com' }).expect(201)).body.id;
    await http().put(`/workers/${ana}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
    await http().post(`/workers/${ana}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    await http().post(`/workers/${ana}/employment`).set(as('admin')).send({ employmentType: 'casual', startsOn: '2026-01-01' }).expect(201);
    await http().post(`/workers/${ana}/app-access`).set(as('admin')).expect(201);
    await signIn('ana', 'ana@example.com');
    await http().get('/my').set(as('ana')).expect(200);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('registers a phone once, and moves it when someone else signs in on it', async () => {
    expect((await http().post('/push-devices').set(as('ana')).send({ token: 'nope', platform: 'android' }).expect(400)).body.message).toMatch(/does not recognise/);
    await http().post('/push-devices').set(as('ana')).send({ token: TOKEN_A, platform: 'web' }).expect(400);
    await http().post('/push-devices').set(as('ana')).send({ token: TOKEN_A }).expect(400);
    await http().post('/push-devices').set(as('ana')).send({ token: TOKEN_A, platform: 'android' }).expect(204);
    await http().post('/push-devices').set(as('ana')).send({ token: TOKEN_A, platform: 'android' }).expect(204);
    expect(await devices()).toEqual([{ token: TOKEN_A, removed_reason: null, live: true }]);
    // The allocator signs in on the same phone: it is theirs now.
    await http().post('/push-devices').set(as('alloc')).send({ token: TOKEN_A, platform: 'android' }).expect(204);
    expect((await devices()).map(d => d.removed_reason)).toEqual(['another_user', null]);
    // Ana's own two phones.
    await http().post('/push-devices').set(as('ana')).send({ token: TOKEN_A, platform: 'android' }).expect(204);
    await http().post('/push-devices').set(as('ana')).send({ token: TOKEN_B, platform: 'ios' }).expect(204);
    expect((await devices()).filter(d => d.live)).toHaveLength(2);
  });

  it('queues an offer to each of their phones, and the log never shows the token', async () => {
    const shiftId = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, areaId: area, role: 'Chef', date: ahead(1), startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
    const r = await http().post(`/shifts/${shiftId}/offers`).set(as('alloc')).send({ workerIds: [ana] }).expect(201);
    expect(r.body.messages).toBe(3); // email + two phones
    const rows = await pushRows();
    expect(rows.map(p => p.to_address).sort()).toEqual([TOKEN_A, TOKEN_B].sort());
    expect(rows[0]).toMatchObject({ template: 'shift_offer', status: 'queued' });
    expect(rows[0].subject).toMatch(/^Shift available: /);
    expect(rows[0].body).toMatch(/^Demo Cafe has a shift for you: .*Open CROP to accept or decline\.$/);
    const log = (await http().get('/notifications').set(as('alloc')).expect(200)).body.messages.filter((m: { channel: string }) => m.channel === 'push');
    expect(log).toHaveLength(2);
    expect(log.every((m: { to: string }) => m.to === 'CROP app')).toBe(true);
    expect(JSON.stringify(log)).not.toContain('PushToken');
  });

  it('sends through the push service and forgets a phone that is no longer registered', async () => {
    push.gone.add(TOKEN_B);
    await dispatcher.runOnce();
    expect(push.sent.map(m => m.to)).toContain(TOKEN_A);
    expect(push.sent[0].title).toMatch(/^Shift available: /);
    const rows = await pushRows();
    expect(rows.find(p => p.to_address === TOKEN_A)!.status).toBe('sent');
    expect(rows.find(p => p.to_address === TOKEN_B)).toMatchObject({ status: 'failed', last_error: 'This phone no longer receives CROP notifications' });
    expect((await devices()).find(d => d.token === TOKEN_B && d.removed_reason === 'not_registered')).toBeTruthy();
    // Tapping it opens their offers in this business.
    expect(push.sent.find(m => m.to === TOKEN_A)!.data).toEqual({ tenant: 'cafe', screen: 'offers' });
  });

  it("tells their phone they're booked when the office records a yes, but not when they said yes in the app", async () => {
    const offerFor = async (shiftId: string) => (await owner.query<{ id: string }>(
      'select id from shift_offers where shift_id = $1 and worker_id = $2', [shiftId, ana])).rows[0].id;
    const first = (await owner.query<{ shift_id: string }>(`select shift_id from shift_offers where worker_id = $1`, [ana])).rows[0].shift_id;
    await http().post(`/offers/${await offerFor(first)}/accept`).set(as('alloc')).expect(200);
    const booked = (await pushRows()).filter(p => p.template === 'shift_booked');
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ to_address: TOKEN_A });
    expect(booked[0].subject).toMatch(/^You're booked: /);
    await dispatcher.runOnce();
    expect(push.sent.at(-1)!.data).toEqual({ tenant: 'cafe', screen: 'shifts' });

    const second = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, areaId: area, role: 'Chef', date: ahead(9), startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${second}/offers`).set(as('alloc')).send({ workerIds: [ana], notify: false }).expect(201);
    await http().post(`/my/offers/${await offerFor(second)}/accept`).set(as('ana')).expect(200);
    expect((await pushRows()).filter(p => p.template === 'shift_booked')).toHaveLength(1);
  });

  it('reminds their phone at every stage before a credential runs out', async () => {
    const now = new Date(); // midnight UTC is 10 or 11am in Melbourne, after reminders start
    now.setUTCHours(0, 0, 0, 0);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(now);
    const type = (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category) values ($1,'Food Safety Supervisor','training') returning id`, [cafe])).rows[0].id;
    await owner.query(`insert into worker_credentials(tenant_id, worker_id, credential_type_id, expiry_date, verification) values ($1,$2,$3,$4,'verified')`,
      [cafe, ana, type, addDays(today, 25)]);
    const reminders = app.get(ExpiryReminders);
    await reminders.runOnce(now);
    await reminders.runOnce(now); // again the same day: nothing new
    const rows = (await pushRows()).filter(p => p.template === 'credential_expiry');
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toMatch(/^Your Food Safety Supervisor expires on /);
    expect(rows[0].body).toBe('Please send your renewal to Demo Cafe. Open CROP to add it.');
    await dispatcher.runOnce();
    expect(push.sent.at(-1)!.data).toEqual({ tenant: 'cafe', screen: 'credentials' });
  });

  it('tells their phone when the roster is published, and stops after sign-out', async () => {
    const shiftId = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, areaId: area, role: 'Chef', date: ahead(2), startTime: '09:00', endTime: '17:00' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${shiftId}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: ahead(0), facilityId: site }).expect(201);
    const published = (await pushRows()).filter(p => p.template === 'roster_published');
    expect(published).toHaveLength(1); // only the phone still registered
    expect(published[0]).toMatchObject({ to_address: TOKEN_A });
    expect(published[0].subject).toMatch(/^Your shifts at Harbour Kitchen for the week of /);
    expect(published[0].body).toMatch(/ 9:00-17:00\. Open CROP to see them\.$/);

    await http().post('/push-devices/remove').set(as('ana')).send({ token: TOKEN_A }).expect(204);
    expect((await devices()).filter(d => d.live)).toEqual([]);
    expect((await devices()).find(d => d.token === TOKEN_A && d.removed_reason === 'signed_out')).toBeTruthy();
  });

  it('says push is off when no sender is set up, and keeps phones to their own business', async () => {
    const pool = new Pool({ connectionString: db.appUrl });
    try {
      expect(await withTenant(pool, other, async c => (await c.query('select * from push_devices')).rowCount)).toBe(0);
      await expect(withTenant(pool, cafe, c => c.query('delete from push_devices'))).rejects.toThrow(/permission denied/);
      const userId = (await owner.query('select user_id from push_devices limit 1')).rows[0].user_id;
      await expect(withTenant(pool, other, c => c.query(
        `insert into push_devices(tenant_id, user_id, token, platform) values ($1, $2, 'ExpoPushToken[cccccccccccccc]', 'ios')`, [cafe, userId]))).rejects.toThrow(/row-level security/);
    } finally {
      await pool.end();
    }
    expect(PUSH_OFF).toBe('Push notifications are not switched on yet');
  });
});
