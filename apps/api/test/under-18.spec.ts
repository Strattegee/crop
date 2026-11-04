import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { ageOn, ageReasons, isUnder18, runsLateAtNight } from '../src/roster/age.js';
import { addDays, todayIn } from '../src/workforce/compliance.js';
import { startFakeIdp } from './fake-idp.js';

// A Monday well in the future, so the week is never history while these tests run.
const WEEK = '2031-06-02';

describe('workers under 18 (David, 3 Nov, answer 8)', () => {
  it('works out whole years on a date, birthdays included', () => {
    expect(ageOn('2014-06-02', '2031-06-01')).toBe(16);
    expect(ageOn('2014-06-02', '2031-06-02')).toBe(17);
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18);
    expect(isUnder18(null, '2031-06-02')).toBe(false);
    expect(isUnder18('2013-06-03', '2031-06-02')).toBe(true);
    expect(isUnder18('2013-06-02', '2031-06-02')).toBe(false);
  });

  it('knows a shift runs into 10pm–6am', () => {
    expect(runsLateAtNight('07:00', '15:00')).toBe(false);
    expect(runsLateAtNight('14:00', '22:00')).toBe(false);
    expect(runsLateAtNight('14:00', '22:30')).toBe(true);
    expect(runsLateAtNight('06:00', '14:00')).toBe(false);
    expect(runsLateAtNight('05:30', '13:00')).toBe(true);
    expect(runsLateAtNight('22:00', '06:00')).toBe(true);
    expect(runsLateAtNight('18:00', '00:00')).toBe(true);
  });

  it('warns for 18-and-over roles and duties and late nights, never saying the age', () => {
    const shift = { role: 'Bar Attendant', localDate: '2031-06-02', localStart: '18:00', localEnd: '23:00' };
    expect(ageReasons('Sam Example', shift, { dateOfBirth: '1990-01-01', adultRole: true, adultDuties: ['Serves alcohol'] })).toEqual([]);
    expect(ageReasons('Sam Example', shift, { dateOfBirth: null, adultRole: true })).toEqual([]);
    const r = ageReasons('Sam Example', shift, { dateOfBirth: '2015-01-01', adultRole: true, adultDuties: ['Serves alcohol'] });
    expect(r.map(x => x.message)).toEqual([
      'Sam Example is under 18 and Bar Attendant is set as 18 and over',
      'Sam Example is under 18 and Serves alcohol is set as 18 and over',
      'Sam Example is under 18 and this {shift} runs between 10pm and 6am',
    ]);
    expect(r.every(x => x.code === 'age' && !/\d{4}|\b1[0-7]\b/.test(x.message.replace('18', '')))).toBe(true);
  });

  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, teen: string, adult: string, roleId: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_under18');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe') returning id`);
    const other = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('other','Other Business') returning id`);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'alloc@x.com','allocator'),($2,'o2@x.com','owner')`,
      [t.rows[0].id, other.rows[0].id]);
    await owner.end();
    for (const [sub, email] of [['owner', 'owner@x.com'], ['alloc', 'alloc@x.com'], ['other', 'o2@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    site = (await http().post('/facilities').set(as('owner')).send({ name: 'Harbour Cafe', state: 'VIC' }).expect(201)).body.id;
    roleId = (await http().post('/roles').set(as('owner')).send({ name: 'Bar Attendant' }).expect(201)).body.id;
    const person = async (firstName: string, dateOfBirth?: string) => {
      const id = (await http().post('/workers').set(as('owner')).send({ firstName, lastName: 'Example', roles: ['Bar Attendant'], dateOfBirth }).expect(201)).body.id;
      await http().put(`/workers/${id}/right-to-work`).set(as('owner')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${id}/right-to-work/verify`).set(as('owner')).send({}).expect(201);
      return id as string;
    };
    teen = await person('Tess', '2014-01-15'); // 17 in June 2031
    adult = await person('Alex', '1995-05-05');
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('records a date of birth for the office, checks it, and marks under-18s on the card', async () => {
    const t = (await http().get(`/workers/${teen}`).set(as('alloc')).expect(200)).body;
    expect(t.dateOfBirth).toBe('2014-01-15');
    expect(t.card.under18).toBe(true);
    expect((await http().get(`/workers/${adult}`).set(as('alloc')).expect(200)).body.card.under18).toBe(false);
    const list = (await http().get('/workers').set(as('alloc')).expect(200)).body as Array<{ id: string; card: { under18: boolean } }>;
    expect(list.find(w => w.id === teen)?.card.under18).toBe(true);

    const tomorrow = addDays(todayIn('Australia/Melbourne'), 2);
    expect((await http().patch(`/workers/${adult}`).set(as('owner')).send({ dateOfBirth: tomorrow }).expect(400)).body.message).toBe("Date of birth can't be in the future");
    expect((await http().patch(`/workers/${adult}`).set(as('owner')).send({ dateOfBirth: '1899-12-31' }).expect(400)).body.message).toBe('Date of birth must be after 1900');
    expect((await http().patch(`/workers/${adult}`).set(as('owner')).send({ dateOfBirth: '15/01/2014' }).expect(400)).body.message).toBe('Date of birth must be a date (YYYY-MM-DD)');
    // Leaving it out keeps it; null clears it.
    expect((await http().patch(`/workers/${teen}`).set(as('owner')).send({ notes: 'Weekends only' }).expect(200)).body.dateOfBirth).toBe('2014-01-15');
    const c = (await http().post('/workers').set(as('owner')).send({ firstName: 'Clear', lastName: 'Example', dateOfBirth: '2000-01-01' }).expect(201)).body.id;
    expect((await http().patch(`/workers/${c}`).set(as('owner')).send({ dateOfBirth: null }).expect(200)).body.dateOfBirth).toBeNull();
    // Another business sees nothing.
    await http().get(`/workers/${teen}`).set(as('other')).expect(404);
  });

  it('sets roles and duties as 18 and over (owners and admins only)', async () => {
    await http().patch(`/roles/${roleId}`).set(as('alloc')).send({ adultsOnly: true }).expect(403);
    await http().patch(`/roles/${roleId}`).set(as('other')).send({ adultsOnly: true }).expect(404);
    expect((await http().patch(`/roles/${roleId}`).set(as('owner')).send({ adultsOnly: true }).expect(200)).body.adultsOnly).toBe(true);
    const roles = (await http().get('/roles').set(as('alloc')).expect(200)).body as Array<{ name: string; adultsOnly: boolean }>;
    expect(roles.find(r => r.name === 'Bar Attendant')?.adultsOnly).toBe(true);
    const duty = (await http().post('/shift-duties').set(as('owner')).send({ name: 'Serves alcohol', adultsOnly: true }).expect(201)).body;
    expect(duty.adultsOnly).toBe(true);
    const plain = (await http().post('/shift-duties').set(as('owner')).send({ name: 'Opens up' }).expect(201)).body;
    expect(plain.adultsOnly).toBe(false);
    expect((await http().patch(`/shift-duties/${plain.id}`).set(as('owner')).send({ adultsOnly: true }).expect(200)).body.adultsOnly).toBe(true);
    await http().patch(`/shift-duties/${plain.id}`).set(as('owner')).send({ adultsOnly: false }).expect(200);
  });

  it('warns (never blocks) for an under-18 on an 18-and-over role or duty, or a late shift', async () => {
    const duties = (await http().get('/shift-duties').set(as('alloc')).expect(200)).body as Array<{ id: string; name: string }>;
    const alcohol = duties.find(d => d.name === 'Serves alcohol')!.id;
    const [day] = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Bar Attendant', date: WEEK, startTime: '10:00', endTime: '16:00', dutyIds: [alcohol] }).expect(201)).body.ids;
    const [late] = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Bar Attendant', date: addDays(WEEK, 1), startTime: '17:00', endTime: '23:30' }).expect(201)).body.ids;

    type C = { workerId: string; eligible: boolean; warnings: Array<{ code: string; message: string }> };
    const ages = (list: C[], id: string) => list.find(c => c.workerId === id)!.warnings.filter(w => w.code === 'age').map(w => w.message);
    const dayList = (await http().get(`/shifts/${day}/candidates`).set(as('alloc')).expect(200)).body.candidates as C[];
    expect(ages(dayList, teen)).toEqual([
      'Tess Example is under 18 and Bar Attendant is set as 18 and over',
      'Tess Example is under 18 and Serves alcohol is set as 18 and over',
    ]);
    expect(dayList.find(c => c.workerId === teen)!.eligible).toBe(true);
    expect(ages(dayList, adult)).toEqual([]);

    await http().patch(`/roles/${roleId}`).set(as('owner')).send({ adultsOnly: false }).expect(200);
    const lateList = (await http().get(`/shifts/${late}/candidates`).set(as('alloc')).expect(200)).body.candidates as C[];
    expect(ages(lateList, teen)).toEqual(['Tess Example is under 18 and this shift runs between 10pm and 6am']);

    // Assigning still works; the warning is the office's call.
    await http().post(`/shifts/${late}/assign`).set(as('alloc')).send({ workerId: teen }).expect(200);
  });
});
