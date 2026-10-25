import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { startFakeIdp } from './fake-idp.js';

describe('roster: shift codes, shifts, assignments and employment', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, perthSite: string, area: string, code: string, nightCode: string;
  let ana: string, ben: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_roster_api');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`, [id('cafe'), id('other')]);
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
    perthSite = (await http().post('/facilities').set(as('admin')).send({ name: 'Perth Depot', state: 'WA' }).expect(201)).body.id;
    area = (await http().post(`/facilities/${site}/areas`).set(as('admin')).send({ name: 'Kitchen' }).expect(201)).body.id;
    ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id;
    ben = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ben', lastName: 'Sample', roles: ['Barista'] }).expect(201)).body.id;
    // Right to work is a hard rule for everyone, so record and verify it.
    for (const w of [ana, ben]) {
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    }
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('manages shift codes', async () => {
    await http().post('/shift-codes').set(as('alloc')).send({ code: 'AM', startTime: '07:00', endTime: '15:30' }).expect(403);
    await http().post('/shift-codes').set(as('admin')).send({ code: 'AM', startTime: '7am', endTime: '15:30' }).expect(400);
    code = (await http().post('/shift-codes').set(as('admin')).send({ code: 'AM', name: 'Morning', startTime: '07:00', endTime: '15:30', breakMinutes: 30 }).expect(201)).body.id;
    await http().post('/shift-codes').set(as('admin')).send({ code: 'am', startTime: '06:00', endTime: '14:00' }).expect(400);
    // A site may have its own AM.
    await http().post('/shift-codes').set(as('admin')).send({ code: 'AM', facilityId: perthSite, startTime: '06:00', endTime: '14:00' }).expect(201);
    nightCode = (await http().post('/shift-codes').set(as('admin')).send({ code: 'ND', startTime: '22:00', endTime: '06:30', breakMinutes: 30 }).expect(201)).body.id;
    const list = await http().get(`/shift-codes?facilityId=${site}`).set(as('alloc')).expect(200);
    expect(list.body.map((c: { code: string }) => c.code)).toEqual(['AM', 'ND']);
  });

  it('creates a single shift in the site\'s time zone, and a block across weekdays', async () => {
    const one = await http().post('/shifts').set(as('alloc')).send({ facilityId: site, areaId: area, shiftCodeId: code, role: 'Chef', date: '2026-11-02' }).expect(201);
    expect(one.body.created).toBe(1);
    const s = await http().get(`/shifts/${one.body.ids[0]}`).set(as('alloc')).expect(200);
    expect(s.body).toMatchObject({ localDate: '2026-11-02', localStart: '07:00', localEnd: '15:30', hours: 8, status: 'open', areaName: 'Kitchen', shiftCode: 'AM' });
    expect(new Date(s.body.startsAt).toISOString()).toBe('2026-11-01T20:00:00.000Z'); // Melbourne is UTC+11 in November

    // Night shift crosses midnight.
    const night = await http().post('/shifts').set(as('alloc')).send({ facilityId: site, shiftCodeId: nightCode, role: 'Chef', date: '2026-11-03' }).expect(201);
    const n = await http().get(`/shifts/${night.body.ids[0]}`).set(as('alloc')).expect(200);
    expect(n.body).toMatchObject({ localStart: '22:00', localEnd: '06:30', hours: 8 });

    // Mon/Wed/Fri for two weeks, two baristas each day.
    const block = await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Barista', startDate: '2026-11-09', endDate: '2026-11-22', weekdays: [1, 3, 5], startTime: '06:00', endTime: '12:00', quantity: 2 }).expect(201);
    expect(block.body.created).toBe(12);
    await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date: '2026-11-02' }).expect(400); // no times
    await http().post('/shifts').set(as('alloc')).send({ facilityId: site, areaId: area, role: 'Chef', date: '2026-11-02', startTime: '09:00', endTime: '09:00' }).expect(400);
    await http().post('/shifts').set(as('alloc')).send({ facilityId: perthSite, areaId: area, role: 'Chef', date: '2026-11-02', startTime: '09:00', endTime: '17:00' }).expect(400); // area at another site
    await http().post('/shifts').set(as('worker')).send({ facilityId: site, role: 'Chef', date: '2026-11-02', startTime: '09:00', endTime: '17:00' }).expect(403);

    const week = await http().get('/shifts?from=2026-11-09&to=2026-11-15').set(as('alloc')).expect(200);
    expect(week.body).toHaveLength(6);
  });

  it('assigns people, blocks double booking, confirms, unassigns and cancels', async () => {
    const day = (await http().get('/shifts?from=2026-11-02&to=2026-11-03').set(as('alloc')).expect(200)).body as Array<{ id: string; localStart: string }>;
    const am = day.find(s => s.localStart === '07:00')!.id;
    const nd = day.find(s => s.localStart === '22:00')!.id;

    const a = await http().post(`/shifts/${am}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    expect(a.body).toMatchObject({ status: 'assigned', workerName: 'Ana Example', warnings: [] });
    await http().post(`/shifts/${am}/assign`).set(as('alloc')).send({ workerId: ben }).expect(409); // already filled

    // An overlapping shift for Ana is blocked.
    const overlap = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date: '2026-11-02', startTime: '14:00', endTime: '20:00' }).expect(201)).body.ids[0];
    const clash = await http().post(`/shifts/${overlap}/assign`).set(as('alloc')).send({ workerId: ana }).expect(409);
    expect(clash.body.message).toMatch(/Ana Example is already rostered .*07:00–15:30 at Harbour Kitchen/);

    // Wrong role is a hard block.
    const b = await http().post(`/shifts/${nd}/assign`).set(as('alloc')).send({ workerId: ben }).expect(409);
    expect(b.body.message).toBe('Ben Sample doesn\'t have the role Chef');
    await http().post(`/shifts/${nd}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);

    const c = await http().post(`/shifts/${am}/confirm`).set(as('alloc')).expect(200);
    expect(c.body).toMatchObject({ status: 'booked', assignmentStatus: 'confirmed' });
    await http().post(`/shifts/${am}/confirm`).set(as('alloc')).expect(409);

    const u = await http().post(`/shifts/${nd}/unassign`).set(as('alloc')).expect(200);
    expect(u.body).toMatchObject({ status: 'open', workerId: null });

    await http().post(`/shifts/${am}/cancel`).set(as('alloc')).send({}).expect(400);
    const x = await http().post(`/shifts/${am}/cancel`).set(as('alloc')).send({ reason: 'Function cancelled' }).expect(200);
    expect(x.body).toMatchObject({ status: 'cancelled', workerId: null, cancelledReason: 'Function cancelled' });
    await http().post(`/shifts/${am}/assign`).set(as('alloc')).send({ workerId: ana }).expect(409);
    // With the earlier shift cancelled, Ana is free for the overlapping one.
    await http().post(`/shifts/${overlap}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
  });

  it('records effective-dated employment terms and shows hours on the roster', async () => {
    await http().post(`/workers/${ana}/employment`).set(as('alloc')).send({ employmentType: 'part_time', startsOn: '2026-01-01' }).expect(403);
    await http().post(`/workers/${ana}/employment`).set(as('admin')).send({ employmentType: 'part_time', contractedHours: 24, startsOn: '2026-01-01' }).expect(201);
    await http().post(`/workers/${ana}/employment`).set(as('admin')).send({ employmentType: 'full_time', contractedHours: 38, startsOn: '2026-11-01' }).expect(201);
    await http().post(`/workers/${ana}/employment`).set(as('admin')).send({ employmentType: 'casual', startsOn: '2026-10-01' }).expect(400);
    await http().post(`/workers/${ana}/employment`).set(as('admin')).send({ employmentType: 'zero_hours', startsOn: '2027-01-01' }).expect(400);
    const terms = await http().get(`/workers/${ana}/employment`).set(as('alloc')).expect(200);
    expect(terms.body).toMatchObject([
      { employmentType: 'full_time', contractedHours: 38, startsOn: '2026-11-01', endsOn: null },
      { employmentType: 'part_time', contractedHours: 24, startsOn: '2026-01-01', endsOn: '2026-10-31' },
    ]);

    const roster = await http().get('/roster?from=2026-11-02&to=2026-11-08').set(as('alloc')).expect(200);
    const anaRow = roster.body.people.find((p: { id: string }) => p.id === ana);
    expect(anaRow).toMatchObject({ employmentType: 'full_time', contractedHours: 38, rosteredHours: 6 }); // only the 14:00–20:00 shift remains
    expect(roster.body.shifts.every((s: { status: string }) => s.status !== 'cancelled')).toBe(true);
    await http().get('/roster?from=2026-11-08&to=2026-11-02').set(as('alloc')).expect(400);
  });

  it('lists who could work a shift and enforces credentials, visa hours and rest', async () => {
    const food = (await http().post('/credential-types').set(as('admin')).send({ name: 'Food handling', category: 'training', hasNumber: false, needsEvidence: false }).expect(201)).body.id;
    await http().post('/credential-requirements').set(as('admin')).send({ credentialTypeId: food, scope: 'role', role: 'Chef', severity: 'hard' }).expect(201);
    const today = new Date().toISOString().slice(0, 10);
    const cara = (await http().post('/workers').set(as('admin')).send({ firstName: 'Cara', lastName: 'Demo', roles: ['Chef'] }).expect(201)).body.id;
    await http().put(`/workers/${cara}/right-to-work`).set(as('admin')).send({
      status: 'visa_holder', visaType: 'Student', visaSubclass: '500', visaExpiry: '2030-01-01', workLimit: 'limited', workHoursPerFortnight: 20,
      vevoCheckedOn: today, vevoResult: 'confirmed',
    }).expect(200);
    await http().post(`/workers/${cara}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    const addFood = async (w: string, expiryDate: string) => {
      const c = (await http().post(`/workers/${w}/credentials`).set(as('admin')).send({ credentialTypeId: food, expiryDate }).expect(201)).body.id;
      await http().post(`/workers/${w}/credentials/${c}/verify`).set(as('admin')).send({}).expect(201);
    };
    await addFood(cara, '2030-01-01');
    await addFood(ana, '2026-11-05'); // current today, expired by the shift date

    const mk = async (date: string, startTime: string, endTime: string) =>
      (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date, startTime, endTime }).expect(201)).body.ids[0] as string;
    const tue = await mk('2026-11-10', '09:00', '17:00');
    await http().get(`/shifts/${tue}/candidates`).set(as('worker')).expect(403);
    const c = await http().get(`/shifts/${tue}/candidates`).set(as('alloc')).expect(200);
    expect(c.body.shift).toMatchObject({ id: tue, localDate: '2026-11-10' });
    expect(c.body.candidates.map((x: { name: string; eligible: boolean }) => `${x.name}:${x.eligible}`)).toEqual(['Cara Demo:true', 'Ana Example:false', 'Ben Sample:false']);
    const anaRow = c.body.candidates.find((x: { workerId: string }) => x.workerId === ana);
    expect(anaRow.blocks).toEqual([{ code: 'credential', message: 'Ana Example\'s Food handling will have expired by the shift date' }]);
    expect(c.body.candidates.find((x: { workerId: string }) => x.workerId === ben).blocks.map((b: { code: string }) => b.code)).toEqual(['role']);

    const blocked = await http().post(`/shifts/${tue}/assign`).set(as('alloc')).send({ workerId: ana }).expect(409);
    expect(blocked.body.message).toMatch(/Food handling will have expired/);
    await http().post(`/shifts/${tue}/assign`).set(as('alloc')).send({ workerId: cara }).expect(200);

    // Eight hours after Tuesday's finish: allowed, with a rest warning (default minimum 10 hours).
    const early = await mk('2026-11-11', '01:00', '04:00');
    const w = await http().post(`/shifts/${early}/assign`).set(as('alloc')).send({ workerId: cara }).expect(200);
    expect(w.body.warnings).toEqual([expect.stringMatching(/Cara Demo would have 8 hours' rest between this shift and Tue 10 Nov 09:00–17:00/)]);

    // 11 hours so far this fortnight; 10 more would be over her visa's 20.
    const thu = await mk('2026-11-12', '09:00', '19:00');
    const over = await http().post(`/shifts/${thu}/assign`).set(as('alloc')).send({ workerId: cara }).expect(409);
    expect(over.body.message).toMatch(/Cara Demo's visa allows 20 hours a fortnight; this shift would make 21 hours/);
    const list = (await http().get(`/shifts/${thu}/candidates`).set(as('alloc')).expect(200)).body.candidates;
    expect(list.find((x: { workerId: string }) => x.workerId === cara)).toMatchObject({ eligible: false, weekHours: 11 });

    // The business can change its rest rule.
    await http().patch('/settings').set(as('admin')).send({ minRestHours: 30 }).expect(400);
    expect((await http().patch('/settings').set(as('admin')).send({ minRestHours: 8 }).expect(200)).body.minRestHours).toBe(8);
  });

  it('keeps each business\'s roster separate', async () => {
    const theirs = await http().get('/shifts?from=2026-11-01&to=2026-11-30').set(as('other')).expect(200);
    expect(theirs.body).toEqual([]);
    const any = (await http().get('/shifts?from=2026-11-02&to=2026-11-02').set(as('alloc')).expect(200)).body[0].id;
    await http().get(`/shifts/${any}`).set(as('other')).expect(404);
    await http().post(`/shifts/${any}/assign`).set(as('other')).send({ workerId: ana }).expect(404);
    await http().post('/shifts').set(as('other')).send({ facilityId: site, role: 'Chef', date: '2026-11-02', startTime: '09:00', endTime: '17:00' }).expect(400);
    await http().get(`/workers/${ana}/employment`).set(as('other')).expect(404);
  });
});
