import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { addDays, todayIn } from '../src/workforce/compliance.js';
import { defaultFocus, kpiByKey, KPIS, kpisFor, median, percent, seesCosts, standing, targetRefusal, worded } from '../src/dashboard/kpis.js';
import { makeWords, T } from '../src/terms/words.js';
import { startFakeIdp } from './fake-idp.js';

describe('dashboard rules (David, 31 Oct)', () => {
  it('marks a number only against the business\'s own target', () => {
    expect(standing(90, null, 'higher')).toBe('no_target');
    expect(standing(null, 95, 'higher')).toBe('no_data');
    expect(standing(96, 95, 'higher')).toBe('on_target');
    expect(standing(94, 95, 'higher')).toBe('off_target');
    expect(standing(3, 2, 'lower')).toBe('off_target');
    expect(standing(0, 0, 'lower')).toBe('on_target');
  });
  it('focus defaults by role; owners always see costs', () => {
    expect(defaultFocus('allocator')).toBe('allocator');
    expect(defaultFocus('admin')).toBe('overview');
    expect(seesCosts('owner', false)).toBe(true);
    expect(seesCosts('admin', false)).toBe(false);
    expect(seesCosts('allocator', true)).toBe(true);
  });
  it('has the numbers from the strategy doc for each dashboard', () => {
    for (const f of ['allocator', 'compliance'] as const) expect(kpisFor(f)).toHaveLength(5);
    expect(kpisFor('recruitment')).toHaveLength(4);
    expect(new Set(KPIS.map(k => k.key)).size).toBe(KPIS.length);
  });
  it("uses the business's words", () => {
    const w = makeWords([{ code: T.shift, singular: 'Job', plural: 'Jobs' }]);
    expect(worded(kpiByKey('blocked_shifts')!.label, w, T)).toBe('Blocked jobs, 7 days');
    expect(worded(kpiByKey('started_unfilled')!.label, w, T)).toBe('Jobs that started empty');
    expect(KPIS.every(k => !/\bshifts?\b/i.test((k.label + k.how + k.question).replace(/\{\w+\}/g, "")))).toBe(true);
  });
  it('statistics and target checks', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(1, 0)).toBeNull();
    const pct = KPIS.find(k => k.unit === 'percent')!;
    const cnt = KPIS.find(k => k.unit === 'count')!;
    expect(targetRefusal(pct, 101)).toMatch(/at most 100/);
    expect(targetRefusal(cnt, 1.5)).toMatch(/whole/);
    expect(targetRefusal(cnt, -1)).toMatch(/0 or more/);
    expect(targetRefusal(pct, 95)).toBeNull();
  });
});

describe('dashboards end to end', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDatabase('crop_dashboard');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('care','Demo Care'),('other','Other') returning id`);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`,
      [t.rows[0].id, t.rows[1].id]);
    await owner.end();
    for (const [sub, email, name] of [['owner', 'owner@x.com', 'Olive Owner'], ['admin', 'admin@x.com', 'Adam Admin'], ['alloc', 'alloc@x.com', 'Alice Allocator'], ['worker', 'w@x.com', 'Wes Worker'], ['other', 'o@x.com', 'Oscar Other']]) {
      idp.addUser({ sub, email, email_verified: true, name });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    for (const w of ['owner', 'admin', 'alloc', 'other']) {
      const me = (await http().get('/me').set(as(w)).expect(200)).body;
      ids[w] = me.id;
    }
    site = (await http().post('/facilities').set(as('owner')).send({ name: 'Bayside House', state: 'VIC' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('only the owner sees and sets the team\'s dashboards', async () => {
    await http().get('/team').set(as('admin')).expect(403);
    await http().put(`/team/${ids.alloc}`).set(as('admin')).send({ focus: 'compliance' }).expect(403);
    const team = (await http().get('/team').set(as('owner')).expect(200)).body as Array<{ userId: string; role: string; effectiveFocus: string; seesCosts: boolean }>;
    expect(team.map(m => m.role)).toEqual(['owner', 'admin', 'allocator']);
    expect(team.find(m => m.role === 'allocator')).toMatchObject({ effectiveFocus: 'allocator', seesCosts: false });
    expect(team.find(m => m.role === 'owner')).toMatchObject({ seesCosts: true });
    await http().put(`/team/${ids.admin}`).set(as('owner')).send({ focus: 'payroll' }).expect(400);
    await http().put(`/team/${ids.admin}`).set(as('owner')).send({ focus: 'compliance', seesCosts: true }).expect(200);
    await http().put(`/team/${ids.other}`).set(as('owner')).send({ focus: 'compliance' }).expect(404);
    const after = (await http().get('/team').set(as('owner')).expect(200)).body as Array<{ role: string; focus: string; seesCosts: boolean }>;
    expect(after.find(m => m.role === 'admin')).toMatchObject({ focus: 'compliance', seesCosts: true });
    // Changing only the focus keeps the costs choice.
    await http().put(`/team/${ids.admin}`).set(as('owner')).send({ focus: 'recruitment' }).expect(200);
    const again = (await http().get('/team').set(as('owner')).expect(200)).body as Array<{ role: string; focus: string; seesCosts: boolean }>;
    expect(again.find(m => m.role === 'admin')).toMatchObject({ focus: 'recruitment', seesCosts: true });
  });

  it('each person lands on their dashboard; workers have none', async () => {
    const a = (await http().get('/dashboard').set(as('admin')).expect(200)).body;
    expect(a).toMatchObject({ focus: 'recruitment', assignedByOwner: true, seesCosts: true });
    expect(a.funnel).toHaveLength(6);
    const al = (await http().get('/dashboard').set(as('alloc')).expect(200)).body;
    expect(al).toMatchObject({ focus: 'allocator', assignedByOwner: false, seesCosts: false });
    expect(al.kpis.map((k: { key: string }) => k.key)).toEqual(['filled_48h', 'time_to_fill', 'last_minute_gaps', 'offer_acceptance', 'agency_share']);
    const c = (await http().get('/dashboard?focus=compliance').set(as('alloc')).expect(200)).body;
    expect(c.focus).toBe('compliance');
    expect(c.kpis).toHaveLength(5);
    await http().get('/dashboard?focus=nope').set(as('alloc')).expect(400);
    await http().get('/dashboard').set(as('worker')).expect(403);
  });

  it('works out fill for the next 48 hours and marks it against the business\'s target', async () => {
    const zone = 'Australia/Melbourne';
    const tomorrow = addDays(todayIn(zone), 1);
    await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Carer', date: tomorrow, startTime: '09:00', endTime: '17:00', quantity: 2 }).expect(201);
    let k = (await http().get('/dashboard').set(as('alloc')).expect(200)).body.kpis.find((x: { key: string }) => x.key === 'filled_48h');
    expect(k).toMatchObject({ value: 0, standing: 'no_target', suggested: 95, detail: '2 of 2 still to fill' });
    await http().put('/dashboard/targets').set(as('alloc')).send({ targets: [{ key: 'filled_48h', value: 90 }] }).expect(403);
    await http().put('/dashboard/targets').set(as('admin')).send({ targets: [{ key: 'filled_48h', value: 101 }] }).expect(400);
    await http().put('/dashboard/targets').set(as('admin')).send({ targets: [{ key: 'filled_48h', value: 90 }, { key: 'stage_limit_days', value: 3 }] }).expect(200);
    k = (await http().get('/dashboard').set(as('alloc')).expect(200)).body.kpis.find((x: { key: string }) => x.key === 'filled_48h');
    expect(k).toMatchObject({ target: 90, standing: 'off_target' });
    const targets = (await http().get('/dashboard/targets').set(as('alloc')).expect(200)).body as Array<{ key: string; target: number | null; setting: boolean }>;
    expect(targets.find(x => x.key === 'filled_48h')!.target).toBe(90);
    expect(targets.find(x => x.key === 'stage_limit_days')).toMatchObject({ target: 3, setting: true });
    await http().put('/dashboard/targets').set(as('owner')).send({ targets: [{ key: 'filled_48h', value: null }] }).expect(200);
    k = (await http().get('/dashboard').set(as('alloc')).expect(200)).body.kpis.find((x: { key: string }) => x.key === 'filled_48h');
    expect(k.standing).toBe('no_target');
  });

  it('counts applicants waiting longer than the business\'s stage limit', async () => {
    const a = (await http().post('/workers').set(as('alloc')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Carer'], applicant: true }).expect(201)).body.id;
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    await owner.query(`update workers set stage_changed_at = now() - interval '5 days' where id = $1`, [a]);
    await owner.end();
    const r = (await http().get('/dashboard?focus=recruitment').set(as('alloc')).expect(200)).body;
    expect(r.kpis.find((x: { key: string }) => x.key === 'stuck')).toMatchObject({ value: 1, detail: 'Most at Applied · over 3 days' });
    expect(r.funnel[0]).toMatchObject({ stage: 'applied', reached: 1, movedOn: 0 });
  });

  it('another business sees none of it', async () => {
    const team = (await http().get('/team').set(as('other')).expect(200)).body as Array<{ name: string }>;
    expect(team.map(m => m.name)).toEqual(['Oscar Other']);
    const targets = (await http().get('/dashboard/targets').set(as('other')).expect(200)).body as Array<{ target: number | null }>;
    expect(targets.every(x => x.target === null)).toBe(true);
    const d = (await http().get('/dashboard?focus=recruitment').set(as('other')).expect(200)).body;
    expect(d.kpis.find((x: { key: string }) => x.key === 'stuck').value).toBe(0);
  });
});
