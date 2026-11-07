import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { NotificationDispatcher } from '../src/notifications/dispatcher.js';
import { ManagerAlerts } from '../src/notifications/manager-alerts-data.js';
import {
  ALERT_DEFAULTS, atRiskKind, atRiskPush, changeRequestPush, detailChangePush, inQuiet, swapPush, leavePush, planAlert, pulledOutPush, quietEndsAt, quietLine, quietProblem, seesSite, soonWords,
} from '../src/notifications/manager-alerts.js';
import { pushScreen } from '../src/notifications/push.js';
import { MemoryPush, PUSH_SENDER } from '../src/notifications/senders.js';
import { makeWords } from '../src/terms/words.js';
import { localTimeOf } from '../src/demo/demo-time.js';
import { startFakeIdp } from './fake-idp.js';

const MEL = 'Australia/Melbourne';

describe('office phone alerts: pure rules and wording', () => {
  it('checks quiet hours', () => {
    expect(quietProblem(null, null)).toBeNull();
    expect(quietProblem('22:00', '06:00')).toBeNull();
    expect(quietProblem('22:00', null)).toMatch(/both/);
    expect(quietProblem('10pm', '06:00')).toMatch(/times like/);
    expect(quietProblem('24:00', '06:00')).toMatch(/times like/);
    expect(quietProblem('06:00', '06:00')).toMatch(/different/);
    expect(quietLine(ALERT_DEFAULTS)).toBe('Quiet from 22:00 to 06:00');
    expect(quietLine({ quietFrom: null, quietUntil: null })).toBe('No quiet hours');
  });

  it('knows when quiet hours run, past midnight too', () => {
    expect(inQuiet('23:30', '22:00', '06:00')).toBe(true);
    expect(inQuiet('05:59', '22:00', '06:00')).toBe(true);
    expect(inQuiet('06:00', '22:00', '06:00')).toBe(false);
    expect(inQuiet('12:00', '22:00', '06:00')).toBe(false);
    expect(inQuiet('13:00', '12:30', '14:00')).toBe(true);
    expect(inQuiet('14:00', '12:30', '14:00')).toBe(false);
    expect(inQuiet('03:00', null, null)).toBe(false);
  });

  it('holds until quiet hours end, in the business time zone', () => {
    // 11pm Melbourne (AEDT, UTC+11) on 9 Nov = 12:00 UTC: quiet until 6am on 10 Nov = 19:00 UTC on 9 Nov.
    const lateEvening = new Date('2026-11-09T12:00:00Z');
    expect(quietEndsAt(lateEvening, MEL, ALERT_DEFAULTS)!.toISOString()).toBe('2026-11-09T19:00:00.000Z');
    // 3am Melbourne on 10 Nov = 16:00 UTC on 9 Nov: the same morning's 6am.
    expect(quietEndsAt(new Date('2026-11-09T16:00:00Z'), MEL, ALERT_DEFAULTS)!.toISOString()).toBe('2026-11-09T19:00:00.000Z');
    // Midday: not quiet.
    expect(quietEndsAt(new Date('2026-11-09T01:00:00Z'), MEL, ALERT_DEFAULTS)).toBeNull();

    expect(planAlert('decisions', ALERT_DEFAULTS, lateEvening, MEL, true)).toEqual({ send: true, notBefore: new Date('2026-11-09T19:00:00Z') });
    expect(planAlert('at_risk', ALERT_DEFAULTS, lateEvening, MEL, false)).toEqual({ send: false });
    expect(planAlert('at_risk', ALERT_DEFAULTS, new Date('2026-11-09T01:00:00Z'), MEL, false)).toEqual({ send: true, notBefore: null });
    expect(planAlert('decisions', { ...ALERT_DEFAULTS, decisions: false }, new Date('2026-11-09T01:00:00Z'), MEL, true)).toEqual({ send: false });
    expect(planAlert('at_risk', { ...ALERT_DEFAULTS, quietFrom: null, quietUntil: null }, lateEvening, MEL, false)).toEqual({ send: true, notBefore: null });
  });

  it('tells only the office people who see the site', () => {
    expect(seesSite({ role: 'owner', sites: [] }, 'a')).toBe(true);
    expect(seesSite({ role: 'admin', sites: [] }, null)).toBe(true);
    expect(seesSite({ role: 'allocator', sites: [] }, 'a')).toBe(true);
    expect(seesSite({ role: 'allocator', sites: ['b'] }, 'a')).toBe(false);
    expect(seesSite({ role: 'supervisor', sites: ['a'] }, 'a')).toBe(true);
    expect(seesSite({ role: 'supervisor', sites: [] }, 'a')).toBe(false);
    expect(seesSite({ role: 'supervisor', sites: ['a'] }, null)).toBe(false);
    expect(seesSite({ role: 'worker', sites: [] }, 'a')).toBe(false);
  });

  it('words alerts in the business words, without kinds of leave or notes', () => {
    const jobs = makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }, { code: 1045, singular: 'Schedule', plural: 'Schedules' }]);
    const s = { role: 'Chef', facilityName: 'Harbour Kitchen', areaName: 'Kitchen', localStart: '07:00', localEnd: '15:00', workerName: null, agencyName: null, assignmentStatus: null } as const;
    expect(soonWords(45)).toBe('45 min');
    expect(soonWords(60)).toBe('1 h');
    expect(soonWords(95)).toBe('1 h 35 min');
    expect(atRiskKind(s)).toBe('open');
    expect(atRiskKind({ assignmentStatus: 'assigned', agencyName: null })).toBe('unconfirmed');
    expect(atRiskKind({ assignmentStatus: 'assigned', agencyName: 'Caring For You' })).toBe('to_approve');
    expect(atRiskKind({ assignmentStatus: 'confirmed', agencyName: null })).toBeNull();
    expect(atRiskPush('open', s, 90, jobs)).toEqual({ title: 'Unfilled: Chef at Harbour Kitchen in 1 h 30 min', body: 'Job 07:00–15:00 at Harbour Kitchen, Kitchen has nobody on it. Open CROP to fill it.' });
    expect(atRiskPush('unconfirmed', { ...s, workerName: 'Ana Example', assignmentStatus: 'assigned' }, 40, jobs).body).toBe("Ana Example hasn't confirmed job 07:00–15:00 at Harbour Kitchen, Kitchen. Open CROP to follow up.");
    expect(atRiskPush('to_approve', { ...s, workerName: 'Bo Example', agencyName: 'Caring For You', assignmentStatus: 'assigned' }, 40, jobs).title).toBe('Approve Bo Example from Caring For You?');
    expect(pulledOutPush({ agencyName: 'Caring For You', personName: 'Bo Example', role: 'Nurse', siteName: 'Bayside', when: 'Mon 9 Nov, 7:00am to 3:00pm' }, jobs))
      .toEqual({ title: 'Caring For You pulled Bo Example out', body: 'Nurse, Mon 9 Nov, 7:00am to 3:00pm at Bayside. The job is open again. Open CROP to fill it.' });
    expect(leavePush({ name: 'Ana Example', startsOn: '2026-11-09', endsOn: '2026-11-11', shiftsDuring: 2 }, jobs))
      .toEqual({ title: 'Leave to approve: Ana Example', body: 'Mon 9 Nov to Wed 11 Nov. 2 jobs rostered then. Open CROP to approve or decline.' });
    expect(leavePush({ name: 'Ana Example', startsOn: '2026-11-09', endsOn: '2026-11-09', shiftsDuring: 0 }).body).toBe('Mon 9 Nov. Open CROP to approve or decline.');
    expect(changeRequestPush({ who: 'Sam Allocator', summary: 'Cancel: client rang', facilityName: 'Harbour Kitchen', shiftLine: 'Mon 9 Nov, 07:00–15:00, Chef' }, jobs).title)
      .toBe('Schedule change to approve at Harbour Kitchen');
    const sh = { localDate: '2026-11-09', localStart: '07:00', localEnd: '15:00', site: 'Harbour Kitchen' };
    expect(swapPush({ fromName: 'Ana Example', toName: 'Bo Example', shift: sh, other: null }, jobs))
      .toEqual({ title: 'Job swap to approve: Ana Example and Bo Example', body: 'Ana Example gives Bo Example Mon 9 Nov 07:00–15:00 at Harbour Kitchen. Open CROP to approve or not.' });
    expect(swapPush({ fromName: 'Ana Example', toName: 'Bo Example', shift: sh, other: { ...sh, localDate: '2026-11-10', localStart: '15:00', localEnd: '23:00' } }).body)
      .toBe("Ana Example's Mon 9 Nov 07:00–15:00 for Bo Example's Tue 10 Nov 15:00–23:00 at Harbour Kitchen. Open CROP to approve or not.");
    expect(detailChangePush({ name: 'Ana Example', what: 'Change mobile' }))
      .toEqual({ title: 'Details to approve: Ana Example', body: 'Ana Example asked in the app: change mobile. Open CROP to approve or decline.' });
  });

  it('opens the manager side of the app when tapped', () => {
    expect(pushScreen('office_shift_at_risk')).toBe('attention');
    expect(pushScreen('office_pulled_out')).toBe('attention');
    expect(pushScreen('office_leave_to_approve')).toBe('requests');
    expect(pushScreen('office_change_to_approve')).toBe('requests');
    expect(pushScreen('office_swap_to_approve')).toBe('requests');
    expect(pushScreen('office_detail_to_approve')).toBe('requests');
  });
});

/** The Monday at least a week ahead, plus `day` days (YYYY-MM-DD). */
function ahead(day = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7 + ((8 - d.getUTCDay()) % 7) + day);
  return d.toISOString().slice(0, 10);
}

const hhmm = (d: Date) => localTimeOf(d, MEL);

describe('office phone alerts: settings, shifts at risk and requests', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let alerts: ManagerAlerts;
  const push = new MemoryPush();
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let cafe: string, siteA: string, siteB: string, ana: string;
  const TOKENS: Record<string, string> = {
    admin: 'ExponentPushToken[admin00000000000000000]',
    alloc: 'ExponentPushToken[alloc00000000000000000]',
    sup: 'ExponentPushToken[super00000000000000000]',
    ana: 'ExponentPushToken[anaana00000000000000000]',
  };
  const who = (token: string) => Object.entries(TOKENS).find(([, t]) => t === token)?.[0];
  const alertRows = async (template: string) => (await owner.query<{ to_address: string; subject: string; body: string; later: boolean }>(
    `select to_address, subject, body, next_attempt_at > now() + interval '1 minute' as later from notifications
      where channel = 'push' and template = $1 order by created_at, to_address`, [template])).rows.map(r => ({ ...r, who: who(r.to_address) }));
  const newShift = async (facility: string, minutesAhead: number) => (await owner.query<{ id: string }>(
    `insert into shifts(tenant_id, facility_id, role, starts_at, ends_at)
     values ($1, $2, 'Chef', now() + make_interval(mins => $3), now() + make_interval(mins => $3 + 480)) returning id`, [cafe, facility, minutesAhead])).rows[0].id;
  /** Quiet hours that cover right now in Melbourne. */
  const quietNow = () => {
    const n = Date.now();
    return { quietFrom: hhmm(new Date(n - 60 * 60_000)), quietUntil: hhmm(new Date(n + 60 * 60_000)) };
  };
  const noQuiet = { quietFrom: null, quietUntil: null };

  beforeAll(async () => {
    db = await createTestDatabase('crop_manager_alerts');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    cafe = (await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe') returning id`)).rows[0].id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'sup@x.com','supervisor')`, [cafe]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['sup', 'sup@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: sub });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PUSH_SENDER).useValue(push).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    alerts = app.get(ManagerAlerts);

    siteA = (await http().post('/facilities').set(as('admin')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    siteB = (await http().post('/facilities').set(as('admin')).send({ name: 'Hill Street', state: 'VIC' }).expect(201)).body.id;
    await http().get('/me').set(as('sup')).expect(200);
    const sup = (await owner.query<{ id: string }>(`select id from users where email = 'sup@x.com'`)).rows[0].id;
    await owner.query('insert into member_sites(tenant_id, user_id, facility_id) values ($1, $2, $3)', [cafe, sup, siteA]);
    ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Chef'], email: 'ana@example.com' }).expect(201)).body.id;
    await http().post(`/workers/${ana}/app-access`).set(as('admin')).expect(201);
    idp.addUser({ sub: 'ana', email: 'ana@example.com', email_verified: true, name: 'Ana' });
    tok.ana = await idp.token('ana', { expiresIn: '1h' });
    await http().get('/my').set(as('ana')).expect(200);
    for (const w of ['admin', 'alloc', 'sup', 'ana']) await http().post('/push-devices').set(as(w)).send({ token: TOKENS[w], platform: 'ios' }).expect(204);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('each office person has their own alert choices, with defaults', async () => {
    const mine = (await http().get('/alerts').set(as('alloc')).expect(200)).body;
    expect(mine).toEqual({ decisions: true, atRisk: true, quietFrom: '22:00', quietUntil: '06:00', quietLine: 'Quiet from 22:00 to 06:00', phones: 1, timezone: MEL, decides: false });
    expect((await http().get('/alerts').set(as('admin')).expect(200)).body.decides).toBe(true);
    await http().get('/alerts').set(as('ana')).expect(403);
    expect((await http().put('/alerts').set(as('alloc')).send({ quietFrom: '22:00', quietUntil: null }).expect(400)).body.message).toMatch(/both/);
    expect((await http().put('/alerts').set(as('alloc')).send({ quietFrom: 'late' }).expect(400)).body.message).toMatch(/times like/);
    await http().put('/alerts').set(as('alloc')).send({ atRisk: 'yes' }).expect(400);
    const set = (await http().put('/alerts').set(as('alloc')).send({ quietFrom: '21:30', quietUntil: '07:00' }).expect(200)).body;
    expect(set).toMatchObject({ decisions: true, atRisk: true, quietFrom: '21:30', quietUntil: '07:00' });
    // Only theirs: the admin still has the defaults.
    expect((await http().get('/alerts').set(as('admin')).expect(200)).body.quietFrom).toBe('22:00');
    // Everyone clear for the next tests, and the audit log shows the change.
    for (const w of ['admin', 'alloc', 'sup']) await http().put('/alerts').set(as(w)).send(noQuiet).expect(200);
    expect((await owner.query(`select count(*)::int as n from audit_log where table_name = 'member_alerts'`)).rows[0].n).toBeGreaterThan(0);
  });

  it('a shift starting soon with nobody on it goes to the phones of the people who see its site, once', async () => {
    const atB = await newShift(siteB, 90);
    const later = await newShift(siteA, 300); // not soon yet
    expect(await alerts.runOnce()).toBe(2);
    let rows = await alertRows('office_shift_at_risk');
    expect(rows.map(r => r.who).sort()).toEqual(['admin', 'alloc']); // the supervisor only has Harbour Kitchen; workers never
    expect(rows[0].subject).toMatch(/^Unfilled: Chef at Hill Street in 1 h (2\d|30) min$/);
    expect(rows[0].body).toMatch(/has nobody on it\. Open CROP to fill it\.$/);
    expect(await alerts.runOnce()).toBe(0);

    // At Harbour Kitchen the supervisor hears too; someone there but not confirmed is its own alert.
    const atA = await newShift(siteA, 45);
    await alerts.runOnce();
    expect((await alertRows('office_shift_at_risk')).filter(r => r.subject.includes('Harbour Kitchen')).map(r => r.who).sort()).toEqual(['admin', 'alloc', 'sup']);
    await owner.query(`insert into shift_assignments(tenant_id, shift_id, worker_id, status) values ($1, $2, $3, 'assigned')`, [cafe, atA, ana]);
    await owner.query(`update shifts set status = 'assigned' where id = $1`, [atA]);
    await alerts.runOnce();
    rows = (await alertRows('office_shift_at_risk')).filter(r => r.subject.startsWith('Not confirmed'));
    expect(rows).toHaveLength(3);
    expect(rows[0].subject).toBe(`Not confirmed: Ana Example, Chef in ${rows[0].subject.match(/in (.*)$/)![1]}`);
    // Confirmed or cancelled: nothing more.
    await owner.query(`update shift_assignments set status = 'confirmed' where shift_id = $1`, [atA]);
    await owner.query(`update shifts set status = 'cancelled', cancelled_reason = 'test' where id = $1`, [atB]);
    expect(await alerts.runOnce()).toBe(0);
    void later;
  });

  it('follows each person: switched off, or quiet hours now (tried again after)', async () => {
    await http().put('/alerts').set(as('alloc')).send({ atRisk: false }).expect(200);
    await http().put('/alerts').set(as('admin')).send(quietNow()).expect(200);
    const before = (await alertRows('office_shift_at_risk')).length;
    await newShift(siteB, 60);
    expect(await alerts.runOnce()).toBe(0);
    // Quiet hours over: the next check sends it, since it still matters.
    await http().put('/alerts').set(as('admin')).send(noQuiet).expect(200);
    expect(await alerts.runOnce()).toBe(1);
    expect((await alertRows('office_shift_at_risk')).slice(before).map(r => r.who)).toEqual(['admin']);
    await http().put('/alerts').set(as('alloc')).send({ atRisk: true }).expect(200);
  });

  it('leave asked for in the app goes to the owners and admins who decide it, held through quiet hours', async () => {
    await http().put('/alerts').set(as('admin')).send(quietNow()).expect(200);
    await http().post('/my/leave').set(as('ana')).send({ kind: 'personal', startsOn: ahead(1), endsOn: ahead(2), note: 'Doctor' }).expect(201);
    const rows = await alertRows('office_leave_to_approve');
    expect(rows.map(r => r.who)).toEqual(['admin']); // not the allocator (doesn't decide), not the supervisor, not Ana
    expect(rows[0]).toMatchObject({ subject: 'Leave to approve: Ana Example', later: true });
    expect(rows[0].body).not.toMatch(/personal|Doctor/i);
    // Held: the sender doesn't take it yet.
    await app.get(NotificationDispatcher).runOnce();
    expect(push.sent.find(m => m.to === TOKENS.admin && m.title.startsWith('Leave'))).toBeUndefined();
    // Decisions switched off: nothing.
    await http().put('/alerts').set(as('admin')).send({ decisions: false, ...noQuiet }).expect(200);
    await http().post('/my/leave').set(as('ana')).send({ kind: 'annual', startsOn: ahead(10), endsOn: ahead(10) }).expect(201);
    expect(await alertRows('office_leave_to_approve')).toHaveLength(1);
  });

  it('sends at-risk alerts and opens the manager side when tapped', async () => {
    await app.get(NotificationDispatcher).runOnce();
    const sent = push.sent.find(m => m.title.startsWith('Unfilled'));
    expect(sent!.data).toEqual({ tenant: 'cafe', screen: 'attention' });
  });
});
