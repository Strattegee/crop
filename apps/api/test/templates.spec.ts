import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { applySummary, copyWeeksSummary, planWeek, weekPairs, type Slot } from '../src/roster/templates.js';
import { startFakeIdp } from './fake-idp.js';

const slot = (over: Partial<Slot>): Slot => ({
  weekday: 1, startTime: '07:00', endTime: '15:00', breakMinutes: 30, areaId: null, shiftCodeId: null, role: 'Chef',
  needsPerson: true, workerId: null, notes: null, equipmentIds: [], ...over,
});

describe('roster templates: rules', () => {
  it('places each slot on its weekday in the target week, in order', () => {
    const plan = planWeek([slot({ weekday: 7, startTime: '22:00', endTime: '06:00' }), slot({ weekday: 3, startTime: '12:00' }), slot({ weekday: 3 })], '2026-11-09');
    expect(plan.map(p => [p.date, p.startTime, p.overnight])).toEqual([
      ['2026-11-11', '07:00', false], ['2026-11-11', '12:00', false], ['2026-11-15', '22:00', true],
    ]);
  });

  it('sums up what happened in plain words', () => {
    const none = { equipmentBooked: 0, equipmentLeftOff: [] };
    expect(applySummary({ created: 0, assigned: 0, leftOpen: [], ...none })).toBe('There were no shifts to add.');
    expect(applySummary({ created: 1, assigned: 0, leftOpen: [], ...none })).toBe('1 shift added.');
    expect(applySummary({
      created: 2, assigned: 0, leftOpen: [], equipmentBooked: 1,
      equipmentLeftOff: [{ date: '2026-11-11', startTime: '07:00', role: 'Equipment only', equipmentName: 'Truck 2', reason: 'Truck 2 is out of service' }],
    })).toBe('2 shifts added. 1 equipment booking made. 1 equipment booking left off: Truck 2 is out of service.');
    expect(applySummary({
      created: 5, assigned: 3, ...none,
      leftOpen: [{ date: '2026-11-11', startTime: '07:00', role: 'Chef', workerName: 'Ana Example', reason: 'Ana Example is on leave on Wed 11 Nov' }],
    })).toBe('5 shifts added, 3 with their usual person (waiting for them to confirm). 1 left open because the usual person can\'t work it: Ana Example is on leave on Wed 11 Nov.');
  });
});

describe('copying several weeks: rules', () => {
  it('pairs each week with the one it goes into, and refuses overlaps', () => {
    expect(weekPairs('2026-11-02', 2, '2026-11-30')).toEqual({ pairs: [{ from: '2026-11-02', to: '2026-11-30' }, { from: '2026-11-09', to: '2026-12-07' }] });
    expect(weekPairs('2026-11-02', 4, '2026-11-23')).toHaveProperty('error');
    expect(weekPairs('2026-11-23', 4, '2026-11-02')).toHaveProperty('error');
    expect(weekPairs('2026-11-02', 4, '2026-11-30')).toHaveProperty('pairs');
    expect(weekPairs('2026-11-02', 7, '2026-12-28')).toEqual({ error: 'Choose from 1 to 6 weeks to copy' });
  });

  it('sums up the weeks copied', () => {
    const base = { created: 3, assigned: 0, leftOpen: [], equipmentBooked: 0, equipmentLeftOff: [] };
    expect(copyWeeksSummary({ ...base, created: 0, weeks: [{ from: '2026-11-02', to: '2026-11-30', created: 0 }], emptyWeeks: ['2026-11-02'] })).toBe('There were no shifts to add.');
    expect(copyWeeksSummary({
      ...base, emptyWeeks: ['2026-11-16'],
      weeks: [{ from: '2026-11-02', to: '2026-11-30', created: 2 }, { from: '2026-11-09', to: '2026-12-07', created: 1 }, { from: '2026-11-16', to: '2026-12-14', created: 0 }],
    })).toBe('Copied into 2 weeks, from the week of 30 Nov to the week of 7 Dec. 3 shifts added. The week of 16 Nov had no shifts, so nothing was copied from it.');
  });
});

describe('roster templates and copying a week', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let tenantId: string, otherId: string;
  let site: string, ana: string, ben: string, templateId: string;
  // Melbourne: daylight saving ends on Sunday 4 April 2027, between these two weeks.
  const SOURCE = '2027-03-29';
  const TARGET = '2027-04-05';

  beforeAll(async () => {
    db = await createTestDatabase('crop_templates_api');
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
    ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id;
    ben = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ben', lastName: 'Sample', roles: ['Chef'] }).expect(201)).body.id;
    for (const w of [ana, ben]) {
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    }
    // The source week: Ana Monday and Tuesday mornings, Ben Wednesday night (overnight), one open Friday shift, one cancelled.
    const made = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Chef', startDate: SOURCE, endDate: '2027-03-30', startTime: '07:00', endTime: '15:00', breakMinutes: 30 }).expect(201)).body.ids;
    for (const id of made) await http().post(`/shifts/${id}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    await http().post(`/shifts/${made[0]}/confirm`).set(as('alloc')).expect(200);
    const night = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date: '2027-03-31', startTime: '22:00', endTime: '06:00' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${night}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);
    await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date: '2027-04-02', startTime: '10:00', endTime: '18:00' }).expect(201);
    const gone = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date: '2027-04-03', startTime: '10:00', endTime: '18:00' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${gone}/cancel`).set(as('alloc')).send({ reason: 'Closed' }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  const plus6 = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const weekShifts = async (from: string) => (await http().get(`/roster?from=${from}&to=${plus6(from)}&facilityId=${site}`)
    .set(as('alloc')).expect(200)).body.shifts as Array<{ localDate: string; localStart: string; localEnd: string; status: string; workerName: string | null; breakMinutes: number }>;

  it('saves a week as a template, leaving out cancelled shifts', async () => {
    await http().post('/roster/templates').set(as('worker')).send({ facilityId: site, weekStart: SOURCE, name: 'Usual week' }).expect(403);
    await http().post('/roster/templates').set(as('alloc')).send({ facilityId: site, weekStart: '2027-05-03', name: 'Empty' }).expect(400);
    const r = await http().post('/roster/templates').set(as('alloc')).send({ facilityId: site, weekStart: '2027-03-31', name: 'Usual week' }).expect(201);
    expect(r.body).toMatchObject({ name: 'Usual week', facilityName: 'Harbour Kitchen', shifts: 4, withPeople: 3 });
    templateId = r.body.id;
    const again = await http().post('/roster/templates').set(as('alloc')).send({ facilityId: site, weekStart: SOURCE, name: 'usual WEEK' }).expect(409);
    expect(again.body.message).toBe('There is already a template called usual WEEK for this site');

    const list = (await http().get(`/roster/templates?facilityId=${site}`).set(as('alloc')).expect(200)).body;
    expect(list.map((x: { name: string }) => x.name)).toEqual(['Usual week']);
    const one = (await http().get(`/roster/templates/${templateId}`).set(as('alloc')).expect(200)).body;
    expect(one.shiftList.map((s: { weekday: number; startTime: string; endTime: string; workerName: string | null }) => [s.weekday, s.startTime, s.endTime, s.workerName])).toEqual([
      [1, '07:00', '15:00', 'Ana Example'], [2, '07:00', '15:00', 'Ana Example'], [3, '22:00', '06:00', 'Ben Sample'], [5, '10:00', '18:00', null],
    ]);
  });

  it('applies a template across a daylight saving change at the same local times, with the usual people', async () => {
    // Ana is on approved leave on the Tuesday of the target week, so that shift stays open.
    await http().post(`/workers/${ana}/leave`).set(as('admin')).send({ kind: 'annual', startsOn: '2027-04-06', endsOn: '2027-04-06' }).expect(201);
    const r = await http().post(`/roster/templates/${templateId}/apply`).set(as('alloc')).send({ weekStart: '2027-04-07' }).expect(200);
    expect(r.body).toMatchObject({ weekStart: TARGET, created: 4, assigned: 2 });
    expect(r.body.leftOpen).toEqual([{ date: '2027-04-06', startTime: '07:00', role: 'Chef', workerName: 'Ana Example', reason: 'Ana Example is on leave on Tue 6 Apr' }]);
    expect(r.body.summary).toContain('2 with their usual person');

    const shifts = await weekShifts(TARGET);
    expect(shifts.map(s => [s.localDate, s.localStart, s.localEnd, s.status, s.workerName])).toEqual([
      ['2027-04-05', '07:00', '15:00', 'assigned', 'Ana Example'],
      ['2027-04-06', '07:00', '15:00', 'open', null],
      ['2027-04-07', '22:00', '06:00', 'assigned', 'Ben Sample'],
      ['2027-04-09', '10:00', '18:00', 'open', null],
    ]);
    expect(shifts[0].breakMinutes).toBe(30);

    // Every new shift is in the week's change log, by the person who applied the template.
    const log = (await http().get(`/roster/changes?weekStart=${TARGET}&facilityId=${site}`).set(as('alloc')).expect(200)).body;
    expect(log.filter((c: { kind: string }) => c.kind === 'created')).toHaveLength(4);
    expect(log.filter((c: { kind: string }) => c.kind === 'assigned')).toHaveLength(2);
  });

  it('won\'t double a week by mistake, or touch a week that is over', async () => {
    const r = await http().post(`/roster/templates/${templateId}/apply`).set(as('alloc')).send({ weekStart: TARGET }).expect(409);
    expect(r.body.message).toBe(`The week of ${TARGET} already has 4 shifts at Harbour Kitchen. Choose "Add to the shifts already there" to add these as well.`);
    const old = await http().post(`/roster/templates/${templateId}/apply`).set(as('alloc')).send({ weekStart: '2026-10-12' }).expect(409);
    expect(old.body.message).toBe('That week is over, so shifts can no longer be added to it');
    // Added on top anyway: the people are already rostered then, so everything stays open.
    const extra = await http().post(`/roster/templates/${templateId}/apply`).set(as('alloc')).send({ weekStart: TARGET, addToExisting: true }).expect(200);
    expect(extra.body).toMatchObject({ created: 4, assigned: 0 });
    expect(extra.body.leftOpen.map((o: { reason: string }) => o.reason)).toEqual([
      expect.stringMatching(/^Ana Example is already rostered/),
      'Ana Example is on leave on Tue 6 Apr',
      expect.stringMatching(/^Ben Sample is already rostered/),
    ]);
  });

  it('copies the previous week, with or without people', async () => {
    const next = '2027-04-12';
    await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: site, toWeek: next, fromWeek: next }).expect(400);
    const r = await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: site, toWeek: next, fromWeek: TARGET }).expect(200);
    expect(r.body).toMatchObject({ fromWeek: TARGET, weekStart: next, created: 8, assigned: 2 });
    const plain = await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: site, toWeek: '2027-04-19', people: false }).expect(200);
    expect(plain.body).toMatchObject({ fromWeek: next, created: 8, assigned: 0, leftOpen: [] });
    expect((await weekShifts('2027-04-19')).every(s => s.status === 'open')).toBe(true);
    const empty = await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: site, toWeek: '2027-06-07' }).expect(400);
    expect(empty.body.message).toBe('There are no shifts at Harbour Kitchen in the week of 2027-05-31 to copy');
  });

  it('carries equipment bookings over, leaving off what can\'t be booked', async () => {
    const depot = (await http().post('/facilities').set(as('admin')).send({ name: 'Depot', state: 'VIC' }).expect(201)).body.id;
    const type = (await http().post('/equipment-types').set(as('admin')).send({ name: 'Truck' }).expect(201)).body.id;
    const truck1 = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: type, name: 'Truck 1', homeFacilityId: depot }).expect(201)).body.id;
    const truck2 = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: type, name: 'Truck 2', homeFacilityId: depot }).expect(201)).body.id;
    const W1 = '2027-05-03', W2 = '2027-05-10';
    // Monday: Ana drives Truck 1. Tuesday: Truck 2 on dry hire (equipment only).
    const wet = (await http().post('/shifts').set(as('alloc')).send({ facilityId: depot, role: 'Chef', date: W1, startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${wet}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    await http().post(`/shifts/${wet}/equipment`).set(as('alloc')).send({ equipmentId: truck1 }).expect(200);
    const dry = (await http().post('/shifts').set(as('alloc')).send({ facilityId: depot, equipmentOnly: true, date: '2027-05-04', startTime: '06:00', endTime: '18:00' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${dry}/equipment`).set(as('alloc')).send({ equipmentId: truck2 }).expect(200);

    const tpl = (await http().post('/roster/templates').set(as('alloc')).send({ facilityId: depot, weekStart: W1, name: 'Depot week' }).expect(201)).body;
    expect(tpl).toMatchObject({ shifts: 2, withPeople: 1, equipmentBookings: 2 });
    const one = (await http().get(`/roster/templates/${tpl.id}`).set(as('alloc')).expect(200)).body;
    expect(one.shiftList.map((x: { equipment: string[]; equipmentOnly: boolean }) => [x.equipment, x.equipmentOnly])).toEqual([[['Truck 1'], false], [['Truck 2'], true]]);
    const bare = (await http().post('/roster/templates').set(as('alloc')).send({ facilityId: depot, weekStart: W1, name: 'No trucks', equipment: false }).expect(201)).body;
    expect(bare.equipmentBookings).toBe(0);

    // Truck 2 goes out of service: applying books Truck 1 again and leaves Truck 2 off, saying why.
    await http().patch(`/equipment/${truck2}`).set(as('admin')).send({ status: 'out_of_service' }).expect(200);
    const r = (await http().post(`/roster/templates/${tpl.id}/apply`).set(as('alloc')).send({ weekStart: W2 }).expect(200)).body;
    expect(r).toMatchObject({ created: 2, assigned: 1, equipmentBooked: 1 });
    expect(r.equipmentLeftOff).toEqual([{ date: '2027-05-11', startTime: '06:00', role: 'Equipment only', equipmentName: 'Truck 2', reason: 'Truck 2 is out of service' }]);
    expect(r.summary).toContain('1 equipment booking left off: Truck 2 is out of service');
    const week2 = (await http().get(`/roster?from=${W2}&to=${plus6(W2)}&facilityId=${depot}`).set(as('alloc')).expect(200)).body.shifts as Array<{ status: string; equipment: Array<{ name: string }> }>;
    expect(week2.map(x => [x.status, x.equipment.map(e => e.name)])).toEqual([['assigned', ['Truck 1']], ['open', []]]);

    // Copying a week carries equipment too, unless asked not to; equipment back in service is booked again.
    await http().patch(`/equipment/${truck2}`).set(as('admin')).send({ status: 'active' }).expect(200);
    const copied = (await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: depot, toWeek: '2027-05-17', fromWeek: W1 }).expect(200)).body;
    expect(copied).toMatchObject({ created: 2, equipmentBooked: 2, equipmentLeftOff: [] });
    const week3 = (await http().get(`/roster?from=2027-05-17&to=2027-05-23&facilityId=${depot}`).set(as('alloc')).expect(200)).body.shifts as Array<{ status: string }>;
    expect(week3.map(x => x.status)).toEqual(['assigned', 'booked']);
    const plain = (await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: depot, toWeek: '2027-05-24', fromWeek: W1, equipment: false }).expect(200)).body;
    expect(plain).toMatchObject({ created: 2, equipmentBooked: 0, equipmentLeftOff: [] });
  });

  it('copies several weeks at once (a month), all or nothing', async () => {
    const empty = await http().post('/roster/copy-weeks').set(as('alloc')).send({ facilityId: site, fromWeek: '2027-05-31', weeks: 2, toWeek: '2027-07-05' }).expect(400);
    expect(empty.body.message).toBe('There are no shifts at Harbour Kitchen in those weeks to copy');
    const overlap = await http().post('/roster/copy-weeks').set(as('alloc')).send({ facilityId: site, fromWeek: SOURCE, weeks: 4, toWeek: '2027-04-12' }).expect(400);
    expect(overlap.body.message).toMatch(/overlap/);
    await http().post('/roster/copy-weeks').set(as('worker')).send({ facilityId: site, fromWeek: SOURCE, weeks: 1, toWeek: '2027-07-05' }).expect(403);
    // The first week copied into already has shifts: refused, and the second week stays empty.
    const busy = await http().post('/roster/copy-weeks').set(as('alloc')).send({ facilityId: site, fromWeek: SOURCE, weeks: 2, toWeek: '2027-04-19' }).expect(409);
    expect(busy.body.message).toMatch(/^The week of 2027-04-19 already has 8 shifts/);
    expect(await weekShifts('2027-04-26')).toEqual([]);

    // Three weeks from 12 April (the third has no shifts) into the three weeks from 14 June.
    const r = (await http().post('/roster/copy-weeks').set(as('alloc')).send({ facilityId: site, fromWeek: '2027-04-14', weeks: 3, toWeek: '2027-06-14', people: false }).expect(200)).body;
    expect(r).toMatchObject({ fromWeek: '2027-04-12', toWeek: '2027-06-14', created: 16, assigned: 0, emptyWeeks: ['2027-04-26'] });
    expect(r.weeks.map((w: { from: string; to: string; created: number }) => [w.from, w.to, w.created])).toEqual([
      ['2027-04-12', '2027-06-14', 8], ['2027-04-19', '2027-06-21', 8], ['2027-04-26', '2027-06-28', 0],
    ]);
    expect(r.summary).toBe('Copied into 2 weeks, from the week of 14 Jun to the week of 21 Jun. 16 shifts added. The week of 26 Apr had no shifts, so nothing was copied from it.');
    expect(await weekShifts('2027-06-21')).toHaveLength(8);

    // By default the copy goes straight after the weeks copied, with the same people where they can work.
    const next = (await http().post('/roster/copy-weeks').set(as('alloc')).send({ facilityId: site, fromWeek: '2027-06-14', weeks: 2 }).expect(200)).body;
    expect(next).toMatchObject({ toWeek: '2027-06-28', created: 16 });
    const log = (await http().get(`/roster/changes?weekStart=2027-07-05&facilityId=${site}`).set(as('alloc')).expect(200)).body;
    expect(log.filter((c: { kind: string }) => c.kind === 'created')).toHaveLength(8);
  });

  it('puts templates away without deleting them, and keeps businesses apart', async () => {
    expect((await http().get('/roster/templates').set(as('other')).expect(200)).body).toEqual([]);
    await http().get(`/roster/templates/${templateId}`).set(as('other')).expect(404);
    await http().post(`/roster/templates/${templateId}/apply`).set(as('other')).send({ weekStart: '2027-05-03' }).expect(404);
    await http().post('/roster/copy-week').set(as('other')).send({ facilityId: site, toWeek: '2027-05-03' }).expect(400);

    await http().post(`/roster/templates/${templateId}/archive`).set(as('alloc')).expect(200);
    expect((await http().get(`/roster/templates?facilityId=${site}`).set(as('alloc')).expect(200)).body).toEqual([]);
    await http().post(`/roster/templates/${templateId}/apply`).set(as('alloc')).send({ weekStart: '2027-05-03' }).expect(404);
    // The name is free again once the old one is put away.
    await http().post('/roster/templates').set(as('alloc')).send({ facilityId: site, weekStart: SOURCE, name: 'Usual week', people: false }).expect(201);

    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [otherId]);
      expect((await c.query('select count(*)::int as n from roster_template_shifts')).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from roster_template_equipment')).rows[0].n).toBe(0);
      await c.query('rollback');
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(c.query('delete from roster_templates')).rejects.toThrow(/permission denied/);
      await c.query('rollback');
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(c.query('delete from roster_template_equipment')).rejects.toThrow(/permission denied/);
      await c.query('rollback');
    } finally {
      await c.end();
    }
  });
});
