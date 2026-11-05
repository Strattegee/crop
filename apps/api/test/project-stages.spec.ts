import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { auditStore, withTenant } from '@crop/db';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import {
  addDays, GAP_REASON, moveLaterStages, moveSummary, noRetime, parseWeekdays, shiftsOutside, type PlacedShift, planSlots, rosterSummary, stageLine, stageOverlaps, stageProblem, stageShortLine,
  shiftsToRetime, supervisorDays, supervisorRole, toCreate, type TimedShift, weekdaysLine, workingDays,
} from '../src/projects/stages.js';
import { itemLine, plannedQuantity, stageItemLines } from '../src/projects/stage-items.js';
import { makeWords } from '../src/terms/words.js';
import { startFakeIdp } from './fake-idp.js';

describe('project stages: rules (David, 5 Nov)', () => {
  it('works out working days, Monday to Friday unless the weekend is ticked', () => {
    // Mon 9 Nov 2026 to Sun 15 Nov.
    expect(workingDays('2026-11-09', '2026-11-15', [1, 2, 3, 4, 5])).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    expect(workingDays('2026-11-13', '2026-11-16', [1, 2, 3, 4, 5, 6])).toEqual(['2026-11-13', '2026-11-14', '2026-11-16']);
    expect(workingDays('2026-11-14', '2026-11-13', [1])).toEqual([]);
    expect(weekdaysLine([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(weekdaysLine([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat');
    expect(weekdaysLine([7, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(weekdaysLine([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(weekdaysLine([6, 7])).toBe('Sat, Sun');
    expect(parseWeekdays([5, 1, 1])).toEqual([1, 5]);
    expect(parseWeekdays(undefined)).toBeNull();
    expect(parseWeekdays([])).toEqual({ problem: 'Tick at least one working day' });
    expect(parseWeekdays([8])).toHaveProperty('problem');
    expect(stageLine({ startsOn: '2026-11-09', endsOn: '2026-11-12', weekdays: [1, 2, 3, 4, 5] })).toBe('Mon 9 Nov – Thu 12 Nov · Mon–Fri · 4 working days');
  });

  it('checks a stage before saving it', () => {
    const ok = { name: 'Build', startsOn: '2026-11-09', endsOn: '2026-11-20', weekdays: [1, 2, 3, 4, 5], startTime: '07:00', endTime: '15:30', shiftCodeId: null };
    expect(stageProblem(ok)).toBeNull();
    expect(stageProblem({ ...ok, name: ' ' })).toBe('Give the stage a name');
    expect(stageProblem({ ...ok, endsOn: '2026-11-01' })).toBe('The last day is before the first day');
    expect(stageProblem({ ...ok, startTime: null })).toBe('Choose a shift type, or enter the usual start and finish times');
    expect(stageProblem({ ...ok, startTime: null, endTime: null, shiftCodeId: 'x' })).toBeNull();
    expect(stageProblem({ ...ok, startsOn: '2026-11-14', endsOn: '2026-11-15' })).toBe('None of those dates is a working day of the stage');
  });

  it('shows overlaps and moves later stages only when asked', () => {
    const stages = [
      { id: 'a', name: 'Demolition', startsOn: '2026-11-09', endsOn: '2026-11-12' },
      { id: 'b', name: 'Build', startsOn: '2026-11-13', endsOn: '2026-11-25' },
      { id: 'c', name: 'Clean', startsOn: '2026-11-25', endsOn: '2026-11-26' },
    ];
    const o = stageOverlaps(stages);
    expect(o.get('a')).toEqual([]);
    expect(o.get('b')).toEqual(['Clean']);
    expect(o.get('c')).toEqual(['Build']);
    expect(moveLaterStages(stages, 'a', '2026-11-12', '2026-11-14')).toEqual([
      { id: 'b', name: 'Build', startsOn: '2026-11-15', endsOn: '2026-11-27' },
      { id: 'c', name: 'Clean', startsOn: '2026-11-27', endsOn: '2026-11-28' },
    ]);
    expect(moveLaterStages(stages, 'b', '2026-11-25', '2026-11-23')).toEqual([]);
    expect(moveLaterStages(stages, 'a', '2026-11-12', '2026-11-11').map(s => s.startsOn)).toEqual(['2026-11-12', '2026-11-24']);
    expect(moveLaterStages(stages, 'a', '2026-11-12', '2026-11-12')).toEqual([]);
  });

  it('plans one place per named person and per gap, and never doubles', () => {
    const makeUp = [{ role: 'Carpenter', count: 2 }, { role: 'Painter', count: 1 }];
    const people = [
      { workerId: 'b', name: 'Ben', role: 'Painter', active: true },
      { workerId: 'a', name: 'Ana', role: 'Carpenter', active: true },
      { workerId: 'x', name: 'Xi', role: 'Carpenter', active: false },
      { workerId: 'd', name: 'Dee', role: 'Cleaner', active: true },
    ];
    const slots = planSlots(makeUp, people);
    expect(slots.map(s => `${s.role}:${s.workerName ?? '-'}`)).toEqual(['Carpenter:Ana', 'Painter:Ben', 'Cleaner:Dee', 'Carpenter:-']);
    expect(stageShortLine(makeUp, people)).toBe('Short: 1 Carpenter');
    expect(stageShortLine(makeUp, [...people, { workerId: 'e', name: 'Eve', role: 'Carpenter', active: true }])).toBeNull();
    // Nothing yet: everything is made.
    expect(toCreate(slots, [])).toEqual({ create: slots, already: 0 });
    // All made before: nothing new.
    const made = slots.map(s => ({ role: s.role, usualWorkerId: s.workerId }));
    expect(toCreate(slots, made)).toEqual({ create: [], already: 4 });
    // The gap was since named (Eve): her place is the open Carpenter shift already made.
    const named = planSlots(makeUp, [...people, { workerId: 'e', name: 'Eve', role: 'Carpenter', active: true }]);
    expect(toCreate(named, made)).toEqual({ create: [], already: 4 });
    // Someone added in a new role gets a new shift.
    const more = [...named, { role: 'Labourer', workerId: 'f', workerName: 'Fay' }];
    expect(toCreate(more, made).create.map(s => s.workerName)).toEqual(['Fay']);
    // Two days' worth on one day only counts once each.
    expect(toCreate(slots, made.slice(0, 2)).create.map(s => `${s.role}:${s.workerName ?? '-'}`)).toEqual(['Cleaner:Dee', 'Carpenter:-']);
  });

  it('gives the supervisor one day for overlapping stages, at the widest hours', () => {
    const days = supervisorDays([
      { startsOn: '2026-11-09', endsOn: '2026-11-11', weekdays: [1, 2, 3, 4, 5], startTime: '07:00', endTime: '15:00', breakMinutes: 30 },
      { startsOn: '2026-11-11', endsOn: '2026-11-14', weekdays: [1, 2, 3, 4, 5, 6], startTime: '06:30', endTime: '14:00', breakMinutes: 0 },
    ]);
    expect([...days.keys()]).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
    expect(days.get('2026-11-11')).toEqual({ startTime: '06:30', endTime: '15:00', breakMinutes: 30 });
    expect(days.get('2026-11-09')).toEqual({ startTime: '07:00', endTime: '15:00', breakMinutes: 30 });
    expect(supervisorRole(['Carpenter', 'Site Supervisor'])).toBe('Site Supervisor');
    expect(supervisorRole(['Carpenter'])).toBe('Carpenter');
    expect(supervisorRole([])).toBe('Supervisor');
  });

  it('sums up a roster press in the business’s words', () => {
    const r = { created: 12, assigned: 8, alreadyRostered: 0, pastDays: 1, leftOpen: [], supervisorCreated: 4, supervisorAssigned: 4 };
    expect(rosterSummary(r)).toBe('Created 16 shifts: 12 with their person, 4 left open. 1 day already past left alone. They are in the Draft roster: nobody is told until you publish.');
    const w = makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }]);
    expect(rosterSummary({ ...r, created: 0, assigned: 0, supervisorCreated: 0, supervisorAssigned: 0, alreadyRostered: 16, pastDays: 0 }, w)).toBe('No new jobs needed. 16 jobs already rostered.');
  });
});

describe('project stages: shifts follow their stage (rules)', () => {
  const sh = (id: string, date: string, more: Partial<PlacedShift> = {}): PlacedShift =>
    ({ id, stageId: 'a', supervisor: false, date, started: false, published: false, agency: false, ...more });
  it('takes off only Draft, not started shifts without an agency person', () => {
    const days = new Map([['a', new Set(['2026-11-10', '2026-11-11'])]]);
    const r = shiftsOutside([
      sh('in', '2026-11-10'), sh('out', '2026-11-09'), sh('pub', '2026-11-09', { published: true }), sh('ag', '2026-11-09', { agency: true, published: true }),
      sh('old', '2026-11-02', { started: true, agency: true }), sh('other', '2026-11-09', { stageId: 'b' }),
      sh('supIn', '2026-11-10', { stageId: null, supervisor: true }), sh('supOut', '2026-11-12', { stageId: null, supervisor: true }),
    ], days, new Set(['2026-11-10']));
    expect(r.cancel).toEqual(['out', 'supOut']);
    expect(r.kept).toEqual({ started: 1, agency: 1, published: 1 });
    // A stage taken off has no days: every shift of it goes.
    expect(shiftsOutside([sh('x', '2026-11-10')], new Map([['a', new Set()]]), new Set()).cancel).toEqual(['x']);
  });
  it('sums it up in the business’s words', () => {
    const w = makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }, { code: 1090, singular: 'Labour hire firm', plural: 'Labour hire firms' }]);
    expect(moveSummary({ cancelled: 2, kept: { started: 0, agency: 1, published: 1 }, roster: null, ...noRetime() }, w))
      .toBe('Took 2 jobs off the Draft roster (no longer on the stage’s working days). Left where they are: 1 in published weeks (change it on the roster, so people are told); 1 with a labour hire firm’s person on it.');
    expect(moveSummary({ cancelled: 0, kept: { started: 0, agency: 0, published: 0 }, roster: null, ...noRetime() }, w)).toBe('Every job is already on the stage’s dates and hours.');
    expect(moveSummary({ cancelled: 1, kept: { started: 0, agency: 0, published: 0 }, roster: null, ...noRetime() }, w, true)).toBe('Took 1 job off the Draft roster.');
  });
});

describe('project stages: shifts follow their stage\'s hours (rules)', () => {
  const sh = (id: string, date: string, more: Partial<TimedShift> = {}): TimedShift => ({
    id, stageId: 'a', supervisor: false, date, started: false, published: false, agency: false,
    role: 'Carpenter', startTime: '07:00', endTime: '15:30', breakMinutes: 30, shiftCodeId: null, ...more,
  });
  const days = new Map([['a', new Set(['2026-11-10', '2026-11-11'])]]);
  const want = new Map([['a', { startTime: '06:00', endTime: '14:30', breakMinutes: 30, shiftCodeId: null }]]);
  it('changes Draft, not started shifts on the stage\'s days to its hours', () => {
    const r = shiftsToRetime([
      sh('x', '2026-11-10'), sh('same', '2026-11-11', { startTime: '06:00', endTime: '14:30' }), sh('off', '2026-11-12'),
      sh('pub', '2026-11-11', { published: true }), sh('ag', '2026-11-11', { agency: true }), sh('old', '2026-11-10', { started: true }),
      sh('b', '2026-11-10', { stageId: 'b' }),
      sh('sup', '2026-11-10', { stageId: null, supervisor: true, shiftCodeId: 'code' }), sh('supNo', '2026-11-12', { stageId: null, supervisor: true }),
    ], want, days, new Map([['2026-11-10', { startTime: '06:00', endTime: '14:30', breakMinutes: 30 }]]));
    expect(r.retime.map(x => x.id)).toEqual(['x', 'sup']);
    expect(r.retime[0]).toMatchObject({ date: '2026-11-10', role: 'Carpenter', hours: { startTime: '06:00' }, supervisor: false });
    expect(r.kept).toEqual({ started: 1, agency: 1, published: 1 });
    // A changed break or shift type counts too; the supervisor's are left out when asked.
    expect(shiftsToRetime([sh('br', '2026-11-10', { startTime: '06:00', endTime: '14:30', breakMinutes: 0 })], want, days, new Map()).retime.length).toBe(1);
    expect(shiftsToRetime([sh('code', '2026-11-10', { startTime: '06:00', endTime: '14:30', shiftCodeId: 'old' })], want, days, new Map()).retime.length).toBe(1);
    expect(shiftsToRetime([sh('sup', '2026-11-10', { stageId: null, supervisor: true })], want, days,
      new Map([['2026-11-10', { startTime: '06:00', endTime: '14:30', breakMinutes: 30 }]]), false).retime).toEqual([]);
  });
  it('sums it up in the business’s words', () => {
    const w = makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }]);
    const p = { date: '2026-11-10', startTime: '06:00', role: 'Carpenter', workerName: 'Ana Example', reason: 'Already rostered' };
    const none = { started: 0, agency: 0, published: 0 };
    expect(moveSummary({ cancelled: 0, kept: none, roster: null, retimed: 3, retimeKept: { started: 2, agency: 0, published: 1 }, takenOff: [p], equipmentKept: [p] }, w))
      .toBe('Changed 3 jobs to the stage’s hours. 1 person couldn’t work the new hours, so that job is open again. 1 job kept the old hours because the equipment on it can’t be used at the new ones. Left at the old hours: 1 in published weeks (change it on the roster, so people are told); 2 already started.');
    expect(moveSummary({ cancelled: 0, kept: none, roster: null, ...noRetime() }, w)).toBe('Every job is already on the stage’s dates and hours.');
  });
});

describe('project stages: items (5 Nov)', () => {
  const gloves = { itemId: 'g', name: 'Gloves', unit: 'pair', tracksStock: true };
  it('words planned against used', () => {
    expect(itemLine({ planned: 40, used: 0, unit: 'pair' })).toBe('40 pair planned · none used yet');
    expect(itemLine({ planned: 40, used: 12, unit: 'pair' })).toBe('40 pair planned · 12 used · 28 to go');
    expect(itemLine({ planned: 40, used: 40, unit: 'pair' })).toBe('40 pair planned · all used');
    expect(itemLine({ planned: 40, used: 45.5, unit: 'pair' })).toBe('40 pair planned · 45.5 used (5.5 over)');
    expect(itemLine({ planned: null, used: 3, unit: 'litre' })).toBe('3 litre used, not planned');
    expect(plannedQuantity('2.5')).toBe(2.5);
    expect(plannedQuantity(0)).toHaveProperty('problem');
    expect(plannedQuantity('lots')).toHaveProperty('problem');
    expect(plannedQuantity(2_000_000)).toHaveProperty('problem');
  });

  it('finds what the stock on hand can\'t cover, leaving finished stages out', () => {
    const stages = [{ id: 'a', state: 'current' as const }, { id: 'b', state: 'upcoming' as const }, { id: 'z', state: 'ended' as const }];
    const planned = [
      { id: 'pa', stageId: 'a', ...gloves, planned: 40, note: null }, { id: 'pb', stageId: 'b', ...gloves, planned: 30, note: 'Spare sizes' },
      { id: 'pz', stageId: 'z', ...gloves, planned: 50, note: null },
      { id: 'pf', stageId: 'a', itemId: 'f', name: 'Fuel', unit: 'litre', tracksStock: false, planned: 100, note: null },
    ];
    const used = [{ stageId: 'a', ...gloves, used: 12 }, { stageId: 'b', itemId: 'm', name: 'Masks', unit: 'each', tracksStock: true, used: 4 }];
    let r = stageItemLines(stages, planned, used, new Map([['g', 20]]));
    expect(r.shortages).toEqual([{ itemId: 'g', name: 'Gloves', unit: 'pair', need: 58, onHand: 20, line: 'Gloves: stages still need 58 pair, 20 on hand here' }]);
    expect(r.byStage.get('a')!.map(l => [l.name, l.toGo, l.short])).toEqual([['Gloves', 28, { need: 58, onHand: 20 }], ['Fuel', 100, null]]);
    expect(r.byStage.get('b')!.map(l => [l.name, l.planned, l.line])).toEqual([['Gloves', 30, '30 pair planned · none used yet'], ['Masks', null, '4 each used, not planned']]);
    expect(r.byStage.get('z')![0].short).toBeNull();
    r = stageItemLines(stages, planned, used, new Map([['g', 58]]));
    expect(r.shortages).toEqual([]);
    expect(stageItemLines(stages, planned, used, new Map()).shortages[0].line).toBe('Gloves: stages still need 58 pair, none on hand here');
  });
});

describe('project stages: API (migration 0093)', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let pool: Pool;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  // A Monday at least a week ahead (in UTC; the site is in Melbourne, so this is safely in the future there too).
  const monday = (() => { let d = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1); return d; })();
  const W = (n: number) => addDays(monday, n);

  beforeAll(async () => {
    db = await createTestDatabase('crop_project_stages');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    pool = new Pool({ connectionString: db.appUrl });
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('build','Example Builders'),('nosy','Nosy Co') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'sup@x.com','supervisor'),($2,'nosy@x.com','owner')`, [ids.build, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['sup', 'sup@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    for (const who of ['admin', 'alloc', 'sup', 'nosy']) await http().get('/me').set(as(who)).expect(200);
    for (const [k, first, roles, rtw] of [
      ['ana', 'Ana', ['Carpenter'], true], ['ben', 'Ben', ['Carpenter', 'Painter'], true], ['cy', 'Cy', ['Plasterer'], true],
      ['dee', 'Dee', ['Cleaner'], false], ['sam', 'Sam', ['Site Supervisor', 'Carpenter'], true], ['eve', 'Eve', ['Carpenter'], true],
    ] as const) {
      ids[k] = (await http().post('/workers').set(as('admin')).send({ firstName: first, lastName: 'Example', roles }).expect(201)).body.id;
      if (rtw) {
        await http().put(`/workers/${ids[k]}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
        await http().post(`/workers/${ids[k]}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      }
    }
    ids.p = (await http().post('/facilities').set(as('admin')).send({ name: 'Beach Hut', kind: 'project', state: 'VIC', postcode: '3000', startsOn: W(0), endsOn: W(20) }).expect(201)).body.id;
    ids.site = (await http().post('/facilities').set(as('admin')).send({ name: 'Head Office', state: 'VIC' }).expect(201)).body.id;
    ids.hut = (await http().post(`/facilities/${ids.p}/areas`).set(as('admin')).send({ name: 'Hut' }).expect(201)).body.id;
    const team = (await http().post('/teams').set(as('admin')).send({ name: 'Demolition', roles: [{ role: 'Carpenter', count: 2 }, { role: 'Painter', count: 1 }] }).expect(201)).body;
    ids.team = team.id;
    await http().post(`/teams/${ids.team}/members`).set(as('admin')).send({ workerId: ids.ana, role: 'Carpenter' }).expect(201);
    await http().post(`/teams/${ids.team}/members`).set(as('admin')).send({ workerId: ids.ben, role: 'Painter' }).expect(201);
    await http().put(`/site-access/${(await owner.query<{ id: string }>(`select id from users where email = 'sup@x.com'`)).rows[0].id}`)
      .set(as('admin')).send({ facilityIds: [ids.p] }).expect(200);
  });

  afterAll(async () => {
    await pool?.end();
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  type Stage = { id: string; name: string; startsOn: string; endsOn: string; teamName: string | null; makeUpLine: string | null; shortLine: string | null;
    people: { id: string; workerId: string; role: string }[]; overlaps: string[]; rostered: { shifts: number; open: number; days: number; outside: number };
    equipment: { equipmentName: string }[] };

  it('adds stages with a copy of a standing team, and changes the copy only', async () => {
    let v = (await http().post(`/projects/${ids.p}/stages`).set(as('alloc')).send({
      name: 'Demolition and make good', areaId: ids.hut, startsOn: W(0), endsOn: W(3), startTime: '07:00', endTime: '15:30', breakMinutes: 30, teamId: ids.team,
    }).expect(201)).body;
    ids.a = v.id;
    let a = v.stages[0] as Stage;
    expect(a).toMatchObject({ name: 'Demolition and make good', teamName: 'Demolition', makeUpLine: '2 Carpenter · 1 Painter', shortLine: 'Short: 1 Carpenter', overlaps: [] });
    expect(a.people.map(p => `${p.role}:${p.workerId === ids.ana ? 'ana' : 'ben'}`).sort()).toEqual(['Carpenter:ana', 'Painter:ben']);
    expect(v.stages[0].line).toMatch(/Mon .* – Thu .* · Mon–Fri · 4 working days/);

    v = (await http().post(`/projects/${ids.p}/stages`).set(as('alloc')).send({ name: 'Build', startsOn: W(7), endsOn: W(9), startTime: '07:00', endTime: '15:30' }).expect(201)).body;
    ids.b = v.id;
    await http().put(`/project-stages/${ids.b}/roles`).set(as('alloc')).send({ roles: [{ role: 'Plasterer', count: 1 }] }).expect(200);
    await http().post(`/project-stages/${ids.b}/people`).set(as('alloc')).send({ workerId: ids.cy, role: 'Plasterer' }).expect(201);
    v = (await http().post(`/projects/${ids.p}/stages`).set(as('alloc')).send({ name: 'Clean', startsOn: W(9), endsOn: W(10), startTime: '08:00', endTime: '16:00', weekdays: [1, 2, 3, 4, 5, 6] }).expect(201)).body;
    ids.c = v.id;
    v = (await http().post(`/project-stages/${ids.c}/people`).set(as('alloc')).send({ workerId: ids.dee, role: 'Cleaner' }).expect(201)).body;
    const byName = (n: string) => (v.stages as Stage[]).find(s => s.name === n)!;
    expect(byName('Build').overlaps).toEqual(['Clean']);
    expect(byName('Clean').overlaps).toEqual(['Build']);

    // Adjusting the stage never changes the standing team.
    v = (await http().post(`/project-stages/${ids.a}/people`).set(as('alloc')).send({ workerId: ids.eve, role: 'Carpenter' }).expect(201)).body;
    expect(byName('Demolition and make good').shortLine).toBeNull();
    const eve = (v.stages as Stage[])[0].people.find(p => p.workerId === ids.eve)!;
    v = (await http().post(`/project-stage-people/${eve.id}/remove`).set(as('alloc')).send({}).expect(201)).body;
    a = (v.stages as Stage[]).find(s => s.id === ids.a)!;
    expect(a.shortLine).toBe('Short: 1 Carpenter');
    const team = (await http().get(`/teams/${ids.team}`).set(as('admin')).expect(200)).body;
    expect(team.members.length).toBe(2);
    expect(team.roles).toEqual([{ role: 'Carpenter', count: 2 }, { role: 'Painter', count: 1 }]);

    // Refusals in plain words.
    await http().post(`/project-stages/${ids.a}/people`).set(as('alloc')).send({ workerId: ids.cy, role: 'Carpenter' }).expect(400);
    await http().post(`/project-stages/${ids.a}/people`).set(as('alloc')).send({ workerId: ids.ana, role: 'Carpenter' }).expect(409);
    const bad = await http().post(`/projects/${ids.p}/stages`).set(as('alloc')).send({ name: 'X', startsOn: W(3), endsOn: W(1), startTime: '07:00', endTime: '15:00' }).expect(400);
    expect(bad.body.message).toBe('The last day is before the first day');
    await http().post(`/projects/${ids.site}/stages`).set(as('alloc')).send({ name: 'X', startsOn: W(0), endsOn: W(1), startTime: '07:00', endTime: '15:00' }).expect(400);
  });

  it('rosters a stage and the supervisor, and never doubles', async () => {
    await http().put(`/projects/${ids.p}/supervisor`).set(as('alloc')).send({ workerId: ids.sam }).expect(200);
    let r = (await http().post(`/project-stages/${ids.a}/roster`).set(as('alloc')).expect(201)).body;
    expect(r).toMatchObject({ created: 12, assigned: 8, alreadyRostered: 0, pastDays: 0, supervisorCreated: 4, supervisorAssigned: 4 });
    expect(r.leftOpen.length).toBe(4);
    expect(r.leftOpen[0]).toMatchObject({ role: 'Carpenter', workerName: null, reason: GAP_REASON });
    expect(r.summary).toMatch(/^Created 16 shifts: 12 with their person, 4 left open\./);
    const shifts = (await owner.query<{ role: string; status: string; usual: string | null; sup: boolean; area: string | null }>(
      `select role, status, usual_worker_id as usual, project_supervisor as sup, area_id as area from shifts where facility_id = $1`, [ids.p])).rows;
    expect(shifts.filter(s => s.sup).every(s => s.role === 'Site Supervisor' && s.status === 'assigned' && s.usual === ids.sam)).toBe(true);
    expect(shifts.filter(s => !s.sup).every(s => s.area === ids.hut)).toBe(true);
    // Draft: nothing published, nobody messaged.
    expect((await owner.query('select 1 from roster_publications where facility_id = $1', [ids.p])).rowCount).toBe(0);
    expect((await owner.query(`select 1 from notifications where tenant_id = $1 and template = 'roster_published'`, [ids.build])).rowCount).toBe(0);
    // The log says who.
    expect((await owner.query(`select distinct via, actor_name from shift_changes where facility_id = $1 and kind = 'created'`, [ids.p])).rows).toEqual([{ via: 'office', actor_name: 'alloc@x.com' }]);

    r = (await http().post(`/project-stages/${ids.a}/roster`).set(as('alloc')).expect(201)).body;
    expect(r).toMatchObject({ created: 0, supervisorCreated: 0, alreadyRostered: 16 });

    // The stage's people come first for its shifts (as the project's team), never a block.
    const open = (await owner.query<{ id: string }>(`select id from shifts where project_stage_id = $1 and status = 'open' limit 1`, [ids.a])).rows[0].id;
    const cands = (await http().get(`/shifts/${open}/candidates`).set(as('alloc')).expect(200)).body.candidates as { workerId: string; team: { teamRole: string } | null }[];
    expect(cands.find(c => c.workerId === ids.eve)?.team).toBeNull();

    // Roster rows say which stage made them (the card's stage line), and which is the supervisor's.
    const stageName = (await owner.query<{ name: string }>('select name from project_stages where id = $1', [ids.a])).rows[0].name;
    expect((await http().get(`/shifts/${open}`).set(as('alloc')).expect(200)).body).toMatchObject({ projectStageId: ids.a, projectStageName: stageName, projectSupervisor: false });
    const supShift = (await owner.query<{ id: string }>(`select id from shifts where facility_id = $1 and project_supervisor limit 1`, [ids.p])).rows[0].id;
    expect((await http().get(`/shifts/${supShift}`).set(as('sup')).expect(200)).body).toMatchObject({ projectSupervisor: true });

    // The whole project: the other stages, and the supervisor once a day even where stages overlap.
    r = (await http().post(`/projects/${ids.p}/roster`).set(as('admin')).expect(201)).body;
    // Build: 3 days of Cy; Clean: 2 days of Dee (no right to work, left open); supervisor Mon–Thu of week 2.
    expect(r).toMatchObject({ created: 5, assigned: 3, supervisorCreated: 4, supervisorAssigned: 4 });
    expect(r.leftOpen.map((x: { workerName: string }) => x.workerName)).toEqual(['Dee Example', 'Dee Example']);
    expect(r.leftOpen[0].reason).not.toMatch(/annual|personal|long service/i);
    const supDays = (await owner.query<{ n: number }>(`select count(*)::int as n from shifts where facility_id = $1 and project_supervisor`, [ids.p])).rows[0].n;
    expect(supDays).toBe(8);
    const v = (await http().get(`/projects/${ids.p}/stages`).set(as('sup')).expect(200)).body;
    expect(v.supervisor).toMatchObject({ name: 'Sam Example', role: 'Site Supervisor', workingDays: 8, daysRostered: 8 });
    expect((v.stages as Stage[]).find(s => s.id === ids.a)!.rostered).toEqual({ shifts: 12, open: 4, days: 4, outside: 0, outsideMovable: 0, offHours: 0, offHoursMovable: 0 });
    const ana = (await owner.query<{ id: string }>(`select id from shifts where project_stage_id = $1 and usual_worker_id = $2 limit 1`, [ids.a, ids.ana])).rows[0].id;
    const c2 = (await http().get(`/shifts/${ana}/candidates`).set(as('alloc')).expect(200)).body.candidates as { workerId: string; team: { teamRole: string } | null }[];
    expect(c2.find(c => c.workerId === ids.ben)?.team).toMatchObject({ teamRole: 'worker', areaName: 'Hut' });
    expect(c2.find(c => c.workerId === ids.sam)?.team).toMatchObject({ teamRole: 'supervisor' });
  });

  it('moves later stages when asked, and books equipment for a stage', async () => {
    let v = (await http().patch(`/project-stages/${ids.a}`).set(as('alloc')).send({ endsOn: W(4) }).expect(200)).body;
    expect(v.moved).toEqual([]);
    expect((v.stages as Stage[]).find(s => s.id === ids.b)!.startsOn).toBe(W(7));
    v = (await http().patch(`/project-stages/${ids.a}`).set(as('alloc')).send({ endsOn: W(5), moveLater: true }).expect(200)).body;
    expect(v.moved.map((m: { name: string; startsOn: string }) => `${m.name}:${m.startsOn}`)).toEqual([`Build:${W(8)}`, `Clean:${W(10)}`]);
    // Shifts already made stay where they were.
    expect((v.stages as Stage[]).find(s => s.id === ids.b)!.rostered.outside).toBe(1);

    const type = (await http().post('/equipment-types').set(as('admin')).send({ name: 'Skip bin' }).expect(201)).body.id;
    const bin = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: type, name: 'Bin 1' }).expect(201)).body.id;
    v = (await http().post(`/project-stages/${ids.b}/equipment`).set(as('alloc')).send({ equipmentId: bin }).expect(201)).body;
    expect((v.stages as Stage[]).find(s => s.id === ids.b)!.equipment.map(e => e.equipmentName)).toEqual(['Bin 1']);
    const alloc = (await owner.query<{ s: string; e: string }>(`select to_char(starts_on, 'YYYY-MM-DD') s, to_char(ends_on, 'YYYY-MM-DD') e from equipment_site_allocations where project_stage_id = $1`, [ids.b])).rows[0];
    expect(alloc).toEqual({ s: W(8), e: W(10) });
    const clash = await http().post(`/project-stages/${ids.c}/equipment`).set(as('alloc')).send({ equipmentId: bin }).expect(409);
    expect(clash.body.message).toMatch(/Bin 1 is already allocated to Beach Hut/);
  });

  it('moves a stage\'s shifts to its new dates, Draft weeks only', async () => {
    const stage = (v: { stages: Stage[] }, id: string) => v.stages.find(s => s.id === id)!;
    // Demolition moves a day later: Monday's shifts (and the supervisor's) come off, Friday's are made. The supervisor's
    // Monday of week 2 goes too: Build moved to the Tuesday in the last test, so no stage works that day now.
    let v = (await http().patch(`/project-stages/${ids.a}`).set(as('alloc')).send({ startsOn: W(1), endsOn: W(4), moveShifts: true }).expect(200)).body;
    expect(v.shifts).toMatchObject({ cancelled: 5, kept: { started: 0, agency: 0, published: 0 }, roster: { created: 3, supervisorCreated: 1 } });
    expect(v.shiftsSummary).toMatch(/^Took 5 shifts off the Draft roster/);
    expect(stage(v, ids.a).rostered).toMatchObject({ shifts: 12, outside: 0, outsideMovable: 0 });
    const gone = (await owner.query<{ reason: string; kind: string }>(
      `select distinct cancelled_reason as reason, cancel_kind as kind from shifts where facility_id = $1 and status = 'cancelled'`, [ids.p])).rows;
    expect(gone).toEqual([{ reason: 'Stage dates changed', kind: 'other' }]);
    expect((await owner.query(`select 1 from shift_changes where facility_id = $1 and kind = 'cancelled' and actor_name = 'alloc@x.com'`, [ids.p])).rowCount).toBe(5);

    // A published week is left for the office to change on the roster, so people are told.
    expect(stage(v, ids.b).rostered).toMatchObject({ outside: 1, outsideMovable: 1 });
    await http().post('/roster/publish').set(as('admin')).send({ facilityId: ids.p, weekStart: W(7), notify: false }).expect(201);
    v = (await http().get(`/projects/${ids.p}/stages`).set(as('alloc')).expect(200)).body;
    expect(stage(v, ids.b).rostered).toMatchObject({ outside: 1, outsideMovable: 0 });
    const r = (await http().post(`/project-stages/${ids.b}/move-shifts`).set(as('alloc')).expect(201)).body;
    expect(r).toMatchObject({ cancelled: 0, kept: { published: 1 }, roster: { created: 1 } });
    expect(r.summary).toMatch(/Left where they are: 1 in published weeks \(change it on the roster/);
    await http().post(`/project-stages/${ids.b}/move-shifts`).set(as('sup')).expect(403);

    // Taking a stage off can take its Draft shifts with it (and the supervisor's on days nobody else works).
    v = (await http().post(`/projects/${ids.p}/stages`).set(as('alloc')).send({ name: 'Touch up', startsOn: W(14), endsOn: W(15), startTime: '07:00', endTime: '15:00' }).expect(201)).body;
    await http().post(`/project-stages/${v.id}/people`).set(as('alloc')).send({ workerId: ids.eve, role: 'Carpenter' }).expect(201);
    expect((await http().post(`/project-stages/${v.id}/roster`).set(as('alloc')).expect(201)).body).toMatchObject({ created: 2, supervisorCreated: 2 });
    const off = (await http().post(`/project-stages/${v.id}/remove`).set(as('alloc')).send({ cancelShifts: true }).expect(201)).body;
    expect(off.shifts).toMatchObject({ cancelled: 4, roster: null });
    expect(off.shiftsSummary).toBe('Took 4 shifts off the Draft roster.');
  });

  it('gives a stage\'s shifts its new hours, taking off anyone who can\'t work them', async () => {
    const stage = (v: { stages: (Stage & { rostered: { offHours: number; offHoursMovable: number } })[] }, id: string) => v.stages.find(s => s.id === id)!;
    // Ana already works early at Head Office on the Wednesday: the new 06:00 start would double book her there.
    const early = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: ids.site, role: 'Carpenter', startDate: W(2), endDate: W(2), startTime: '05:00', endTime: '06:30' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${early}/assign`).set(as('alloc')).send({ workerId: ids.ana }).expect(200);
    const logged = async () => (await owner.query(`select 1 from shift_changes where facility_id = $1 and kind = 'times_changed'`, [ids.p])).rowCount;
    const before = await logged();
    let v = (await http().patch(`/project-stages/${ids.a}`).set(as('alloc')).send({ startTime: '06:00', endTime: '14:30', moveShifts: true }).expect(200)).body;
    // 12 of the stage's shifts and the supervisor's 4 days that only this stage works.
    expect(v.shifts).toMatchObject({ cancelled: 0, retimed: 16, roster: { created: 0, supervisorCreated: 0 } });
    expect(v.shifts.takenOff).toHaveLength(1);
    expect(v.shifts.takenOff[0]).toMatchObject({ date: W(2), workerName: 'Ana Example', role: 'Carpenter' });
    expect(v.shiftsSummary).toMatch(/Changed 16 shifts to the stage’s hours\. 1 person couldn’t work the new hours, so that shift is open again\./);
    expect(stage(v, ids.a).rostered).toMatchObject({ offHours: 0, offHoursMovable: 0 });
    const times = (await owner.query<{ t: string; status: string; usual: string | null }>(
      `select to_char(s.starts_at at time zone f.timezone, 'HH24:MI') || '-' || to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as t, s.status, s.usual_worker_id as usual
         from shifts s join facilities f on f.id = s.facility_id where s.project_stage_id = $1 and s.status <> 'cancelled'`, [ids.a])).rows;
    expect(new Set(times.map(x => x.t))).toEqual(new Set(['06:00-14:30']));
    const anaWed = (await owner.query<{ status: string }>(
      `select s.status from shifts s join facilities f on f.id = s.facility_id where s.project_stage_id = $1 and s.usual_worker_id = $2
          and (s.starts_at at time zone f.timezone)::date = $3::date`, [ids.a, ids.ana, W(2)])).rows[0];
    expect(anaWed.status).toBe('open');
    const sup = (await owner.query<{ t: string }>(
      `select to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as t from shifts s join facilities f on f.id = s.facility_id
        where s.facility_id = $1 and s.project_supervisor and s.status <> 'cancelled' and (s.starts_at at time zone f.timezone)::date = $2::date`, [ids.p, W(1)])).rows[0];
    expect(sup.t).toBe('06:00');
    expect((await logged())! - before!).toBe(16);

    // Without "move", the shifts stay at the old hours and the stage says so; the button brings them in line.
    v = (await http().patch(`/project-stages/${ids.a}`).set(as('alloc')).send({ startTime: '07:00', endTime: '15:30' }).expect(200)).body;
    expect(stage(v, ids.a).rostered).toMatchObject({ offHours: 12, offHoursMovable: 12 });
    const r = (await http().post(`/project-stages/${ids.a}/move-shifts`).set(as('alloc')).expect(201)).body;
    expect(r).toMatchObject({ cancelled: 0, retimed: 16, takenOff: [] });
    expect(r.summary).toBe('Changed 16 shifts to the stage’s hours.');
  });

  it('plans a stage\'s items and counts what its shifts used', async () => {
    const gloves = (await http().post('/items').set(as('admin')).send({ name: 'Gloves', unit: 'pair', tracksStock: true }).expect(201)).body.id;
    const fuel = (await http().post('/items').set(as('admin')).send({ name: 'Fuel', unit: 'litre', tracksStock: false }).expect(201)).body.id;
    await http().post(`/items/${gloves}/receive`).set(as('admin')).send({ facilityId: ids.p, quantity: 30 }).expect(201);
    await http().post(`/project-stages/${ids.a}/items`).set(as('alloc')).send({ itemId: gloves, quantity: 40 }).expect(201);
    await http().post(`/project-stages/${ids.a}/items`).set(as('alloc')).send({ itemId: fuel, quantity: '50' }).expect(201);
    await http().post(`/project-stages/${ids.b}/items`).set(as('alloc')).send({ itemId: gloves, quantity: 30, note: 'Spare sizes' }).expect(201);
    const shift = (await owner.query<{ id: string }>(
      `select id from shifts where project_stage_id = $1 and status <> 'cancelled' and starts_at > now() order by starts_at limit 1`, [ids.a])).rows[0].id;
    await http().post(`/items/${gloves}/issue`).set(as('alloc')).send({ shiftId: shift, quantity: 12 }).expect(201);
    await http().post(`/items/${gloves}/return`).set(as('alloc')).send({ shiftId: shift, quantity: 2 }).expect(201);
    await http().post(`/items/${fuel}/issue`).set(as('alloc')).send({ shiftId: shift, quantity: 5 }).expect(201);

    type Line = { id: string | null; name: string; planned: number | null; used: number; toGo: number; line: string; short: { need: number; onHand: number } | null };
    const lines = (v: { stages: { id: string; items: Line[] }[] }, id: string) => v.stages.find(s => s.id === id)!.items;
    let v = (await http().get(`/projects/${ids.p}/stages`).set(as('sup')).expect(200)).body;
    expect(lines(v, ids.a).map(l => l.line)).toEqual(['50 litre planned · 5 used · 45 to go', '40 pair planned · 10 used · 30 to go']);
    // 30 + 30 still to go, 20 on hand: both stages flagged; fuel isn't counted, so never short.
    expect(v.itemShortages).toEqual([expect.objectContaining({ name: 'Gloves', need: 60, onHand: 20 })]);
    expect(lines(v, ids.a)[1].short).toEqual({ need: 60, onHand: 20 });
    expect(lines(v, ids.b)[0]).toMatchObject({ planned: 30, short: { need: 60, onHand: 20 } });
    expect(lines(v, ids.a)[0].short).toBeNull();

    // A new quantity replaces the plan (kept on file); taking fuel off leaves what was used.
    v = (await http().post(`/project-stages/${ids.a}/items`).set(as('alloc')).send({ itemId: gloves, quantity: 10 }).expect(201)).body;
    expect(lines(v, ids.a).find(l => l.name === 'Gloves')!.line).toBe('10 pair planned · all used');
    expect(v.itemShortages).toEqual([expect.objectContaining({ need: 30, onHand: 20 })]);
    expect((await owner.query('select 1 from project_stage_items where stage_id = $1 and item_id = $2', [ids.a, gloves])).rowCount).toBe(2);
    const fuelLine = lines(v, ids.a).find(l => l.name === 'Fuel')!;
    v = (await http().post(`/project-stage-items/${fuelLine.id}/remove`).set(as('alloc')).expect(201)).body;
    expect(lines(v, ids.a).find(l => l.name === 'Fuel')).toMatchObject({ id: null, line: '5 litre used, not planned' });
    await http().post(`/project-stage-items/${fuelLine.id}/remove`).set(as('alloc')).expect(404);

    // Refusals, and supervisors only read.
    expect((await http().post(`/project-stages/${ids.a}/items`).set(as('alloc')).send({ itemId: gloves, quantity: 0 }).expect(400)).body.message).toBe('Enter how many the stage needs (more than 0)');
    await http().post(`/project-stages/${ids.a}/items`).set(as('alloc')).send({ itemId: ids.p, quantity: 1 }).expect(404);
    await http().post(`/project-stages/${ids.a}/items`).set(as('sup')).send({ itemId: gloves, quantity: 1 }).expect(403);
    await http().post(`/project-stages/${ids.a}/items`).set(as('nosy')).send({ itemId: gloves, quantity: 1 }).expect(404);
    expect((await owner.query(`select 1 from audit_log where table_name = 'project_stage_items'`)).rowCount).toBeGreaterThan(0);
  });

  it('keeps supervisors to reading, and other businesses out', async () => {
    await http().get(`/projects/${ids.p}/stages`).set(as('sup')).expect(200);
    await http().post(`/projects/${ids.p}/stages`).set(as('sup')).send({ name: 'X', startsOn: W(0), endsOn: W(1), startTime: '07:00', endTime: '15:00' }).expect(403);
    await http().post(`/project-stages/${ids.a}/roster`).set(as('sup')).expect(403);
    await http().get(`/projects/${ids.p}/stages`).set(as('nosy')).expect(404);
    await http().post(`/project-stages/${ids.a}/remove`).set(as('nosy')).send({}).expect(404);
    for (const table of ['project_stages', 'project_stage_roles', 'project_stage_people', 'project_stage_items']) {
      const n = await withTenant(pool, ids.nosy, async c => (await c.query(`select count(*)::int as n from ${table}`)).rows[0].n);
      expect(n).toBe(0);
      // Someone limited to another site sees none of the project's stages.
      const limited = await auditStore.run({ scope: { tenantId: ids.build, role: 'allocator', sites: [ids.site] } },
        () => withTenant(pool, ids.build, async c => (await c.query(`select count(*)::int as n from ${table}`)).rows[0].n));
      expect(limited).toBe(0);
    }
    // Stage changes are in the audit log.
    expect((await owner.query(`select 1 from audit_log where table_name = 'project_stages'`)).rowCount).toBeGreaterThan(0);
    // Taking a stage off keeps it on file and its shifts on the roster.
    const v = (await http().post(`/project-stages/${ids.c}/remove`).set(as('alloc')).send({ reason: 'Not needed' }).expect(201)).body;
    expect(v.removed).toBe(true);
    expect((await owner.query('select 1 from shifts where project_stage_id = $1', [ids.c])).rowCount).toBe(2);
    // Turning the project back into a site lets go of the supervisor.
    await http().patch(`/facilities/${ids.p}`).set(as('admin')).send({ kind: 'site' }).expect(200);
    expect((await owner.query<{ s: string | null }>('select supervisor_worker_id s from facilities where id = $1', [ids.p])).rows[0].s).toBeNull();
  });
});
