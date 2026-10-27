import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { changeSummary, mondayOf, rosterMessage, weekState } from '../src/roster/publishing.js';
import { startFakeIdp } from './fake-idp.js';

describe('roster publishing rules', () => {
  it('works out the week state', () => {
    expect(weekState('2026-11-02', false, '2026-10-26')).toBe('draft');
    expect(weekState('2026-11-02', true, '2026-10-26')).toBe('live');
    expect(weekState('2026-10-26', true, '2026-11-01')).toBe('live'); // Sunday is still in the week
    expect(weekState('2026-10-26', true, '2026-11-02')).toBe('history');
    expect(weekState('2026-10-12', false, '2026-10-26')).toBe('history');
  });

  it('finds the Monday', () => {
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(mondayOf('2026-11-04')).toBe('2026-11-02');
  });

  it('words the message staff get when a week is published', () => {
    const m = rosterMessage({ first: 'Ana', business: 'Demo Cafe', site: 'Harbour Kitchen', weekStart: '2026-11-09', updated: false,
      shifts: [{ localDate: '2026-11-09', localStart: '07:00', localEnd: '15:00', role: 'Chef', areaName: 'Kitchen', confirmed: true }] });
    expect(m.subject).toBe('Your shifts at Harbour Kitchen for the week of Mon 9 Nov');
    expect(m.email).toContain('- Mon 9 Nov, 7:00–15:00: Chef (Kitchen)');
    expect(m.sms).toBe('Demo Cafe: your shifts at Harbour Kitchen, wk of Mon 9 Nov: Mon 9 7:00-15:00.');
    const gone = rosterMessage({ first: 'Ana', business: 'Demo Cafe', site: 'Harbour Kitchen', weekStart: '2026-11-09', updated: true, shifts: [] });
    expect(gone.subject).toMatch(/have changed$/);
    expect(gone.email).toContain('You no longer have any shifts at Harbour Kitchen that week.');
  });

  it('describes changes in plain words', () => {
    expect(changeSummary({ kind: 'booked', workerName: 'Ana Example', equipmentName: null, detail: null, via: 'link' }))
      .toBe('Ana Example accepted the offer (reply link) and is booked');
    expect(changeSummary({ kind: 'cancelled', workerName: null, equipmentName: null, detail: 'Closed for the day', via: 'office' }))
      .toBe('Shift cancelled: Closed for the day');
  });
});

describe('roster: draft, live and history with a change log', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let tenantId: string, otherId: string;
  let site: string, depot: string, ana: string, shiftA: string, shiftB: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_publishing_api');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    tenantId = t.rows.find(r => r.slug === 'cafe')!.id;
    otherId = t.rows.find(r => r.slug === 'other')!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`, [tenantId, otherId]);
    await owner.end();
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
    depot = (await http().post('/facilities').set(as('admin')).send({ name: 'Perth Depot', state: 'WA' }).expect(201)).body.id;
    ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id;
    await http().put(`/workers/${ana}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
    await http().post(`/workers/${ana}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    const made = await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Chef', startDate: '2026-11-02', endDate: '2026-11-03', startTime: '07:00', endTime: '15:00' }).expect(201);
    [shiftA, shiftB] = made.body.ids;
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  const week = async (facilityId = site) =>
    (await http().get(`/roster/weeks?weekStart=2026-11-02&facilityId=${facilityId}`).set(as('alloc')).expect(200)).body[0];

  it('starts as a draft, with every new shift in the log', async () => {
    expect(await week()).toMatchObject({ state: 'draft', version: null, shifts: 2, changesSincePublish: 0, facilityName: 'Harbour Kitchen' });
    const log = (await http().get('/roster/changes?weekStart=2026-11-02').set(as('alloc')).expect(200)).body;
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ kind: 'created', summary: 'Shift added', afterPublish: false, via: 'office', role: 'Chef', localStart: '07:00' });
    expect(log[0].actorName).toBeTruthy();
    await http().get('/roster/weeks?weekStart=soon').set(as('alloc')).expect(400);
    await http().get('/roster/weeks?weekStart=2026-11-02').set(as('worker')).expect(403);
  });

  it('publishes a week, and only again once something changed', async () => {
    await http().post('/roster/publish').set(as('worker')).send({ weekStart: '2026-11-02', facilityId: site }).expect(403);
    // Any day in the week means that week.
    const r = await http().post('/roster/publish').set(as('alloc')).send({ weekStart: '2026-11-04', facilityId: site }).expect(201);
    expect(r.body.published).toBe(1);
    expect(r.body.weeks[0]).toMatchObject({ weekStart: '2026-11-02', state: 'live', version: 1, changesSincePublish: 0 });
    expect(r.body.weeks[0].publishedByName).toBeTruthy();
    const again = await http().post('/roster/publish').set(as('alloc')).send({ weekStart: '2026-11-02', facilityId: site }).expect(409);
    expect(again.body.message).toBe('Nothing has changed since this week was published');
  });

  it('logs changes after publishing and counts them until the next publish', async () => {
    await http().post(`/shifts/${shiftA}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    await http().post(`/shifts/${shiftA}/confirm`).set(as('alloc')).expect(200);
    await http().post(`/shifts/${shiftA}/unassign`).set(as('alloc')).send({ pulledOut: true }).expect(200);
    await http().post(`/shifts/${shiftB}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    await http().post(`/shifts/${shiftB}/cancel`).set(as('alloc')).send({ reason: 'Kitchen closed' }).expect(200);
    await http().patch(`/shifts/${shiftB}`).set(as('alloc')).send({ notes: 'Plumber coming' }).expect(200);

    expect(await week()).toMatchObject({ state: 'live', changesSincePublish: 6, shifts: 1 });
    const since = (await http().get(`/roster/changes?weekStart=2026-11-02&facilityId=${site}&sincePublish=true`).set(as('alloc')).expect(200)).body;
    expect(since.map((c: { summary: string }) => c.summary)).toEqual([
      'Notes changed',
      'Shift cancelled: Kitchen closed', // taking Ana off a cancelled shift isn't a separate entry
      'Ana Example put on the shift',
      'Ana Example pulled out',
      'Ana Example confirmed',
      'Ana Example put on the shift',
    ]);
    expect(since.every((c: { afterPublish: boolean }) => c.afterPublish)).toBe(true);

    const history = (await http().get(`/shifts/${shiftA}/history`).set(as('alloc')).expect(200)).body;
    expect(history.map((c: { kind: string }) => c.kind)).toEqual(['created', 'assigned', 'confirmed', 'pulled_out']);

    const r = await http().post('/roster/publish').set(as('admin')).send({ weekStart: '2026-11-02', facilityId: site }).expect(201);
    expect(r.body.weeks[0]).toMatchObject({ version: 2, changesSincePublish: 0 });
  });

  it('publishes every site at once, leaving sites with nothing new alone', async () => {
    const r = await http().post('/roster/publish').set(as('alloc')).send({ weekStart: '2026-11-02' }).expect(201);
    expect(r.body.published).toBe(1); // only the depot, still a draft
    expect(r.body.weeks.map((w: { facilityName: string; version: number }) => [w.facilityName, w.version]))
      .toEqual([['Harbour Kitchen', 2], ['Perth Depot', 1]]);
    expect((await week(depot)).state).toBe('live');
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: '2026-11-02', facilityId: 'nope' }).expect(400);
  });

  it('treats past weeks as history, which can no longer be published', async () => {
    const w = (await http().get(`/roster/weeks?weekStart=2026-10-12&facilityId=${site}`).set(as('alloc')).expect(200)).body[0];
    expect(w.state).toBe('history');
    const r = await http().post('/roster/publish').set(as('alloc')).send({ weekStart: '2026-10-12' }).expect(409);
    expect(r.body.message).toBe('This week is over, so it can no longer be published');
  });

  it('keeps each business\'s log separate, and the log is append-only', async () => {
    const other = (await http().get('/roster/changes?weekStart=2026-11-02').set(as('other')).expect(200)).body;
    expect(other).toEqual([]);
    expect((await http().get('/roster/weeks?weekStart=2026-11-02').set(as('other')).expect(200)).body).toEqual([]);
    await http().get(`/shifts/${shiftA}/history`).set(as('other')).expect(404);

    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [otherId]);
      expect((await c.query('select count(*)::int as n from shift_changes')).rows[0].n).toBe(0);
      await c.query('rollback');
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(c.query(`update shift_changes set detail = 'x'`)).rejects.toThrow(/permission denied/);
      await c.query('rollback');
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(c.query(`delete from roster_publications`)).rejects.toThrow(/permission denied/);
      await c.query('rollback');
    } finally {
      await c.end();
    }
  });

  it('tells staff their shifts when a week is published, and only the people affected after changes', async () => {
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    try {
      const mk = async (firstName: string, email: string, phone: string) => {
        const id = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Sample', roles: ['Chef'], email, phone }).expect(201)).body.id;
        await http().put(`/workers/${id}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
        await http().post(`/workers/${id}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
        return id as string;
      };
      const ben = await mk('Ben', 'ben@crop.test', '0412 345 678');
      const cat = await mk('Cat', 'cat@crop.test', '0412 345 679');
      const ids = (await http().post('/shifts').set(as('alloc'))
        .send({ facilityId: site, role: 'Chef', startDate: '2026-11-09', endDate: '2026-11-10', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids;
      await http().post(`/shifts/${ids[0]}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);
      await http().post(`/shifts/${ids[1]}/assign`).set(as('alloc')).send({ workerId: cat }).expect(200);
      const first = await http().post('/roster/publish').set(as('alloc')).send({ weekStart: '2026-11-09', facilityId: site }).expect(201);
      expect(first.body.messages).toBe(4); // Ben and Cat, email and SMS each
      const sent = async () => (await owner.query(`select to_address, channel, subject, body from notifications where template = 'roster_published' order by created_at, channel`)).rows;
      expect((await sent()).filter(r => r.channel === 'email').map(r => r.to_address).sort()).toEqual(['ben@crop.test', 'cat@crop.test']);

      // Ben is taken off; only Ben hears about it. Publishing without telling staff sends nothing.
      await http().post(`/shifts/${ids[0]}/unassign`).set(as('alloc')).send({}).expect(200);
      const second = await http().post('/roster/publish').set(as('alloc')).send({ weekStart: '2026-11-09', facilityId: site }).expect(201);
      expect(second.body.messages).toBe(2);
      const latest = (await sent()).slice(-2);
      expect(latest.map(r => r.to_address).sort()).toEqual(['+61412345678', 'ben@crop.test']);
      expect(latest.find(r => r.channel === 'email')!.body).toContain('You no longer have any shifts at Harbour Kitchen that week.');
      await http().post(`/shifts/${ids[1]}/confirm`).set(as('alloc')).expect(200);
      const quiet = await http().post('/roster/publish').set(as('alloc')).send({ weekStart: '2026-11-09', facilityId: site, notify: false }).expect(201);
      expect(quiet.body.messages).toBe(0);
    } finally {
      await owner.end();
    }
  });
});
