import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { answeredMessage, breaksRequest, myDayRequestRefusal, requestLine, requestReasons, type DayRequestFacts } from '../src/roster/day-requests.js';
import { auditSummary } from '../src/audit/audit.js';
import { startFakeIdp } from './fake-idp.js';

const ahead = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
const TOKEN = 'ExponentPushToken[dddddddddddddddddddddd]';

describe('requests for a day: rules', () => {
  const r = (over: Partial<DayRequestFacts>): DayRequestFacts => ({ kind: 'prefer_am', atTime: null, note: null, status: 'open', ...over });

  it('words each request, with the note after', () => {
    expect(requestLine(r({}))).toBe('AM {shift} please');
    expect(requestLine(r({ kind: 'prefer_night', note: 'School pick-up' }))).toBe('Night {shift} please · “School pick-up”');
    expect(requestLine(r({ kind: 'finish_by', atTime: '14:00' }))).toBe('Finish by 14:00');
    expect(requestLine(r({ kind: 'start_after', atTime: '10:00' }))).toBe('Start after 10:00');
    expect(requestLine(r({ kind: 'other', note: 'Near the station if possible' }))).toBe('Near the station if possible');
  });

  it('says when a shift goes against a request; other notes are never checked', () => {
    expect(breaksRequest(r({}), '07:00', '15:00')).toBe(false);
    expect(breaksRequest(r({}), '13:00', '21:00')).toBe(true);
    expect(breaksRequest(r({ kind: 'prefer_night' }), '22:00', '06:00')).toBe(false);
    expect(breaksRequest(r({ kind: 'finish_by', atTime: '14:00' }), '07:00', '14:00')).toBe(false);
    expect(breaksRequest(r({ kind: 'finish_by', atTime: '14:00' }), '07:00', '15:00')).toBe(true);
    expect(breaksRequest(r({ kind: 'finish_by', atTime: '23:00' }), '22:00', '06:00')).toBe(true);
    expect(breaksRequest(r({ kind: 'finish_by', atTime: '14:00' }), '07:00', null)).toBe(false);
    expect(breaksRequest(r({ kind: 'start_after', atTime: '10:00' }), '09:30', '17:00')).toBe(true);
    expect(breaksRequest(r({ kind: 'start_after', atTime: '10:00' }), '10:00', '17:00')).toBe(false);
    expect(breaksRequest(r({ kind: 'other', note: 'x' }), '01:00', '23:00')).toBe(false);
  });

  it('gives warnings only for requests still counting, with word tokens', () => {
    expect(requestReasons('Ana', '2026-11-09', '13:00', '21:00', [r({}), r({ kind: 'finish_by', atTime: '14:00' }), r({ status: 'not_possible' }), r({ status: 'withdrawn' })]))
      .toEqual([
        { code: 'request', message: 'Ana asked for AM {shifts} on Mon 9 Nov' },
        { code: 'request', message: 'Ana asked to finish by 14:00 on Mon 9 Nov' },
      ]);
    expect(requestReasons('Ana', '2026-11-09', undefined, null, [r({})])).toEqual([]);
  });

  it('keeps requests to today onwards, 90 days ahead, three waiting a day', () => {
    expect(myDayRequestRefusal('2026-11-02', '2026-11-03', 0)).toBe('Choose today or a later date');
    expect(myDayRequestRefusal('2027-02-02', '2026-11-03', 0)).toBe('Choose a date in the next 90 days');
    expect(myDayRequestRefusal('2026-11-03', '2026-11-03', 3)).toBe('You already have 3 requests waiting for that day. Withdraw one first');
    expect(myDayRequestRefusal('2027-02-01', '2026-11-03', 2)).toBeNull();
  });

  it('tells the person once, in plain words', () => {
    const m = answeredMessage('Ana', '2026-11-09', 'AM shift please', 'not_possible', 'We are short that morning.', 'Demo Cafe');
    expect(m.push).toEqual({ title: 'Request for Mon 9 Nov', body: "Your request for Mon 9 Nov (AM shift please) couldn't be done this time. We are short that morning." });
    expect(m.email.subject).toBe('Demo Cafe: your request for Mon 9 Nov');
    expect(answeredMessage('Ana', '2026-11-09', 'AM shift please', 'done', null, 'Demo Cafe').push.title).toBe('Request for Mon 9 Nov done');
    expect(auditSummary({ tableName: 'day_requests', action: 'insert', oldValues: null, newValues: { id: 'x' } })).toBe('Added Request for a day');
  });
});

describe('requests for a day: app, office, roster and eligibility', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, ana: string, ben: string, shiftPm: string, reqAm: string, reqFinish: string;
  const day = ahead(5);

  const signIn = async (sub: string, email: string) => {
    idp.addUser({ sub, email, email_verified: true, name: sub });
    tok[sub] = await idp.token(sub, { expiresIn: '1h' });
  };

  beforeAll(async () => {
    process.env.NOTIFY_DISPATCH = 'off';
    db = await createTestDatabase('crop_day_requests');
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
    const person = async (firstName: string) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Chef'], email: `${firstName.toLowerCase()}@example.com` }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      await http().post(`/workers/${w}/app-access`).set(as('admin')).expect(201);
      return w;
    };
    ana = await person('Ana');
    ben = await person('Ben');
    await signIn('ana', 'ana@example.com');
    await signIn('ben', 'ben@example.com');
    await http().get('/my').set(as('ana')).expect(200);
    await http().get('/my').set(as('ben')).expect(200);
    shiftPm = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date: day, startTime: '13:00', endTime: '21:00' }).expect(201)).body.ids[0];
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('the person asks in the app for a day; refusals are plain', async () => {
    const a = await http().post('/my/day-requests').set(as('ana')).send({ date: day, kind: 'prefer_am', note: 'School pick-up' }).expect(201);
    expect(a.body).toMatchObject({ date: day, kind: 'prefer_am', status: 'open', line: 'AM shift please · “School pick-up”' });
    reqAm = a.body.id;
    reqFinish = (await http().post('/my/day-requests').set(as('ana')).send({ date: day, kind: 'finish_by', time: '20:00' }).expect(201)).body.id;
    expect((await http().post('/my/day-requests').set(as('ana')).send({ date: day, kind: 'finish_by' }).expect(400)).body.message).toBe('Choose a time');
    expect((await http().post('/my/day-requests').set(as('ana')).send({ date: day, kind: 'other' }).expect(400)).body.message).toBe('Say what you would like');
    expect((await http().post('/my/day-requests').set(as('ana')).send({ date: ahead(-1), kind: 'prefer_pm' }).expect(400)).body.message).toBe('Choose today or a later date');
    await http().post('/my/day-requests').set(as('ana')).send({ date: day, kind: 'nap' }).expect(400);
    // Office people not linked to anyone can't ask.
    await http().post('/my/day-requests').set(as('alloc')).send({ date: day, kind: 'prefer_am' }).expect(404);
    const mine = (await http().get('/my/day-requests').set(as('ana')).expect(200)).body;
    expect(mine.requests.map((r: { line: string }) => r.line)).toEqual(['AM shift please · “School pick-up”', 'Finish by 20:00']);
    expect((await http().get('/my/day-requests').set(as('ben')).expect(200)).body.requests).toEqual([]);
  });

  it('a shift that goes against a request is a warning, never a block', async () => {
    const c = (await http().get(`/shifts/${shiftPm}/candidates`).set(as('alloc')).expect(200)).body.candidates
      .find((x: { workerId: string }) => x.workerId === ana);
    expect(c.eligible).toBe(true);
    expect(c.warnings.filter((w: { code: string }) => w.code === 'request').map((w: { message: string }) => w.message))
      .toEqual([expect.stringMatching(/^Ana Example asked for AM shifts on /), expect.stringMatching(/^Ana Example asked to finish by 20:00 on /)]);
    await http().post(`/shifts/${shiftPm}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
  });

  it('the roster carries the requests; the office lists them with the shifts that day', async () => {
    const roster = (await http().get(`/roster?from=${day}&to=${day}`).set(as('alloc')).expect(200)).body;
    expect(roster.dayRequests.map((r: { workerId: string; line: string }) => [r.workerId, r.line])).toEqual([[ana, 'AM shift please · “School pick-up”'], [ana, 'Finish by 20:00']]);
    const list = (await http().get(`/day-requests?from=${ahead(0)}&to=${ahead(13)}&facilityId=${site}`).set(as('alloc')).expect(200)).body;
    expect(list.requests).toHaveLength(2);
    expect(list.requests[0]).toMatchObject({ workerName: 'Ana Example', status: 'open', shifts: [{ id: shiftPm, localStart: '13:00', localEnd: '21:00', breaks: true }] });
    await http().get('/day-requests').set(as('ana')).expect(403);
    expect((await http().get('/day-requests').set(as('other')).expect(200)).body.requests).toEqual([]);
  });

  it('the office marks one done or not possible and the person is told once (app, else email)', async () => {
    await http().post('/push-devices').set(as('ana')).send({ token: TOKEN, platform: 'android' }).expect(204);
    const done = await http().post(`/day-requests/${reqFinish}/done`).set(as('alloc')).send({ note: 'Finishing at 20:00 is fine.' }).expect(200);
    expect(done.body).toMatchObject({ status: 'done', decidedByName: expect.any(String), decidedNote: 'Finishing at 20:00 is fine.', told: 'app' });
    expect((await http().post(`/day-requests/${reqFinish}/not-possible`).set(as('alloc')).send({}).expect(409)).body.message).toBe('This request has already been answered');
    await http().post(`/day-requests/${reqAm}/not-possible`).set(as('other')).send({}).expect(404);
    await http().post('/push-devices/remove').set(as('ana')).send({ token: TOKEN }).expect(204);
    const no = await http().post(`/day-requests/${reqAm}/not-possible`).set(as('alloc')).send({ note: 'We need you in the afternoon.' }).expect(200);
    expect(no.body).toMatchObject({ status: 'not_possible', told: 'email' });
    const log = (await http().get('/notifications').set(as('admin')).expect(200)).body.messages
      .filter((m: { template: string }) => m.template === 'day_request_answered');
    expect(log.map((m: { channel: string }) => m.channel).sort()).toEqual(['email', 'push']);
    // Not possible no longer warns; done still does (the shift still finishes late).
    const c = (await http().get(`/shifts/${shiftPm}/candidates`).set(as('alloc')).expect(200)).body.candidates.find((x: { workerId: string }) => x.workerId === ana);
    expect(c.warnings.filter((w: { code: string }) => w.code === 'request')).toHaveLength(1);
    // The app shows what was decided.
    const mine = (await http().get('/my/day-requests').set(as('ana')).expect(200)).body.requests;
    expect(mine.map((r: { status: string; decidedNote: string }) => [r.status, r.decidedNote])).toEqual([['not_possible', 'We need you in the afternoon.'], ['done', 'Finishing at 20:00 is fine.']]);
  });

  it('withdrawing: own waiting requests only', async () => {
    const r = (await http().post('/my/day-requests').set(as('ben')).send({ date: day, kind: 'start_after', time: '10:00' }).expect(201)).body.id;
    await http().post(`/my/day-requests/${r}/withdraw`).set(as('ana')).expect(404);
    expect((await http().post(`/my/day-requests/${r}/withdraw`).set(as('ben')).expect(200)).body.status).toBe('withdrawn');
    expect((await http().post(`/day-requests/${r}/done`).set(as('alloc')).send({}).expect(409)).body.message).toBe('They withdrew this request');
    await http().post(`/my/day-requests/${reqAm}/withdraw`).set(as('ana')).expect(409);
  });

  it('keeps every request on record, in the audit log, and away from other businesses', async () => {
    const app2 = new Client({ connectionString: db.appUrl });
    await app2.connect();
    await expect(app2.query('delete from day_requests')).rejects.toThrow(/permission denied/);
    await app2.end();
    const audit = (await owner.query(`select count(*)::int as n from audit_log where table_name = 'day_requests'`)).rows[0].n;
    expect(audit).toBeGreaterThan(3);
    const other = await owner.query(`select id from tenants where slug = 'other'`);
    const client = new Client({ connectionString: db.appUrl });
    await client.connect();
    await client.query('begin');
    await client.query(`select set_config('app.tenant_id', $1, true)`, [other.rows[0].id]);
    expect((await client.query('select count(*)::int as n from day_requests')).rows[0].n).toBe(0);
    await client.query('rollback');
    await client.end();
  });
});
