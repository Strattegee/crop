import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { availabilityReason, leaveReason, parsePeriods, shiftPeriod, type AvailabilityFacts } from '../src/roster/availability.js';
import { shiftEligibility } from '../src/roster/eligibility.js';
import { startFakeIdp } from './fake-idp.js';

describe('availability and leave: rules', () => {
  const facts = (pattern: Array<[number, string[]]>, dates: Array<[string, string[]]> = []): AvailabilityFacts =>
    ({ pattern: new Map(pattern), dates: new Map(dates) }) as AvailabilityFacts;

  it('puts a shift in AM, PM or night by its start time', () => {
    expect(shiftPeriod('05:00')).toBe('am');
    expect(shiftPeriod('11:59')).toBe('am');
    expect(shiftPeriod('12:00')).toBe('pm');
    expect(shiftPeriod('18:59')).toBe('pm');
    expect(shiftPeriod('19:00')).toBe('night');
    expect(shiftPeriod('02:30')).toBe('night');
  });

  it('treats nothing recorded as available', () => {
    expect(availabilityReason('Ana', '2026-11-07', '07:00', facts([]))).toBeNull();
    // Saturday 7 Nov; pattern only says something about Monday.
    expect(availabilityReason('Ana', '2026-11-07', '07:00', facts([[1, []]]))).toBeNull();
  });

  it('warns from the weekly pattern', () => {
    const a = facts([[6, ['am']], [7, []]]);
    expect(availabilityReason('Ana', '2026-11-07', '07:00', a)).toBeNull();
    expect(availabilityReason('Ana', '2026-11-07', '22:00', a)?.message).toBe("Ana isn't usually available for night shifts on Saturdays");
    expect(availabilityReason('Ana', '2026-11-08', '07:00', a)?.message).toBe("Ana doesn't usually work on Sundays");
  });

  it('lets a date entry replace the pattern', () => {
    const a = facts([[6, ['am']]], [['2026-11-07', ['night']], ['2026-11-14', []]]);
    expect(availabilityReason('Ana', '2026-11-07', '22:00', a)).toBeNull();
    expect(availabilityReason('Ana', '2026-11-07', '07:00', a)?.message).toBe("Ana isn't available for AM shifts on Sat 7 Nov");
    expect(availabilityReason('Ana', '2026-11-14', '07:00', a)?.message).toBe("Ana isn't available on Sat 14 Nov");
  });

  it('blocks approved leave and warns on requested leave, without saying what kind', () => {
    expect(leaveReason('Ana', '2026-11-07', [{ startsOn: '2026-11-02', endsOn: '2026-11-08', status: 'approved' }]))
      .toEqual({ hard: true, reason: { code: 'leave', message: 'Ana is on leave on Sat 7 Nov' } });
    expect(leaveReason('Ana', '2026-11-07', [{ startsOn: '2026-11-07', endsOn: '2026-11-07', status: 'requested' }]))
      .toEqual({ hard: false, reason: { code: 'leave', message: 'Ana has asked for leave on Sat 7 Nov' } });
    expect(leaveReason('Ana', '2026-11-09', [{ startsOn: '2026-11-02', endsOn: '2026-11-08', status: 'approved' }])).toBeNull();
    expect(leaveReason('Ana', '2026-11-07', [{ startsOn: '2026-11-07', endsOn: '2026-11-07', status: 'declined' }])).toBeNull();
  });

  it('feeds into shift eligibility', () => {
    const shift = { role: 'Chef', startsAt: new Date('2026-11-06T20:00:00Z'), endsAt: new Date('2026-11-07T04:30:00Z'), localDate: '2026-11-07', localStart: '07:00', hours: 8 };
    const base = { name: 'Ana', roles: ['Chef'], issues: [], others: [], hoursPerFortnight: null, minRestHours: 10 };
    expect(shiftEligibility(shift, base)).toEqual({ eligible: true, blocks: [], warnings: [] });
    const e = shiftEligibility(shift, { ...base, availability: facts([[6, []]]), leave: [{ startsOn: '2026-11-07', endsOn: '2026-11-07', status: 'approved' }] });
    expect(e.eligible).toBe(false);
    expect(e.blocks.map(b => b.code)).toEqual(['leave']);
    expect(e.warnings.map(w => w.code)).toEqual(['availability']);
  });

  it('checks times of day from a request', () => {
    expect(parsePeriods(['night', 'am'])).toEqual(['am', 'night']);
    expect(parsePeriods([])).toEqual([]);
    expect(parsePeriods(['evening'])).toBeNull();
    expect(parsePeriods('am')).toBeNull();
  });
});

describe('availability and leave: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string;
  let ana: string, ben: string;

  // Melbourne site; 2026-11-07 is a Saturday.
  const shift = async (date: string, startTime = '07:00', endTime = '15:30') =>
    (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date, startTime, endTime }).expect(201)).body.ids[0] as string;
  const candidates = async (s: string) =>
    (await http().get(`/shifts/${s}/candidates`).set(as('alloc')).expect(200)).body.candidates as
      Array<{ name: string; eligible: boolean; available: boolean; blocks: Array<{ message: string }>; warnings: Array<{ message: string }> }>;

  beforeAll(async () => {
    db = await createTestDatabase('crop_availability');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`, [id('cafe'), id('other')]);
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
    const person = async (firstName: string) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      await http().post(`/workers/${w}/employment`).set(as('admin')).send({ employmentType: 'bank', startsOn: '2026-01-01' }).expect(201);
      return w;
    };
    ana = await person('Ana');
    ben = await person('Ben');
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('records a weekly pattern and date entries, and ranks people who are free first', async () => {
    await http().put(`/workers/${ana}/availability/pattern`).set(as('alloc'))
      .send({ days: [{ weekday: 6, periods: ['pm', 'night'] }, { weekday: 7, periods: [] }] }).expect(200);
    await http().put(`/workers/${ana}/availability/pattern`).set(as('alloc')).send({ days: [{ weekday: 8, periods: [] }] }).expect(400);
    await http().put(`/workers/${ana}/availability/pattern`).set(as('alloc')).send({ days: [{ weekday: 1, periods: ['evening'] }] }).expect(400);

    const s = await shift('2026-11-07');
    let c = await candidates(s);
    // Ana is "Example" too; Ben has nothing recorded, so he's ready and comes first.
    expect(c.map(x => [x.name, x.eligible, x.available])).toEqual([['Ben Example', true, true], ['Ana Example', true, false]]);
    expect(c[1].warnings.map(w => w.message)).toEqual(["Ana Example isn't usually available for AM shifts on Saturdays"]);

    // A date entry replaces the pattern for that day.
    await http().put(`/workers/${ana}/availability/dates/2026-11-07`).set(as('alloc')).send({ periods: ['am'], note: 'Swapped with her sister' }).expect(200);
    c = await candidates(s);
    expect(c.every(x => x.available)).toBe(true);
    await http().put(`/workers/${ben}/availability/dates/2026-11-07`).set(as('alloc')).send({ periods: [] }).expect(200);
    c = await candidates(s);
    expect(c.find(x => x.name === 'Ben Example')!.warnings.map(w => w.message)).toEqual(["Ben Example isn't available on Sat 7 Nov"]);

    // Not available is a warning: the office can still put them on after a phone call.
    const a = await http().post(`/shifts/${s}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);
    expect(a.body.warnings).toEqual(["Ben Example isn't available on Sat 7 Nov"]);

    const got = await http().get(`/workers/${ana}/availability?from=2026-11-01&to=2026-11-30`).set(as('alloc')).expect(200);
    expect(got.body.pattern).toEqual([{ weekday: 6, periods: ['pm', 'night'] }, { weekday: 7, periods: [] }]);
    expect(got.body.dates).toEqual([{ date: '2026-11-07', periods: ['am'], note: 'Swapped with her sister' }]);

    await http().delete(`/workers/${ana}/availability/dates/2026-11-07`).set(as('alloc')).expect(204);
    expect((await http().get(`/workers/${ana}/availability?from=2026-11-01&to=2026-11-30`).set(as('alloc')).expect(200)).body.dates).toEqual([]);
    await http().get(`/workers/${ana}/availability`).set(as('worker')).expect(403);
  });

  it('blocks approved leave, warns on requested leave and lists clashing shifts', async () => {
    const s1 = await shift('2026-11-10');
    await http().post(`/shifts/${s1}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);

    // Allocators record requests; they can't approve.
    await http().post(`/workers/${ana}/leave`).set(as('alloc')).send({ kind: 'annual', startsOn: '2026-11-09', endsOn: '2026-11-13', approved: true }).expect(400);
    const req = await http().post(`/workers/${ana}/leave`).set(as('alloc')).send({ kind: 'annual', startsOn: '2026-11-09', endsOn: '2026-11-13' }).expect(201);
    expect(req.body).toMatchObject({ status: 'requested', days: 5, kind: 'annual', workerName: 'Ana Example' });
    expect(req.body.rostered.map((r: { id: string }) => r.id)).toEqual([s1]);
    await http().post(`/workers/${ana}/leave`).set(as('admin')).send({ kind: 'personal', startsOn: '2026-11-13', endsOn: '2026-11-14' }).expect(409);
    await http().post(`/workers/${ana}/leave`).set(as('admin')).send({ kind: 'holiday', startsOn: '2026-11-20', endsOn: '2026-11-20' }).expect(400);
    await http().post(`/workers/${ana}/leave`).set(as('admin')).send({ kind: 'annual', startsOn: '2026-11-20', endsOn: '2026-11-19' }).expect(400);

    const s2 = await shift('2026-11-11');
    let ana2 = (await candidates(s2)).find(x => x.name === 'Ana Example')!;
    expect(ana2.eligible).toBe(true);
    expect(ana2.warnings.map(w => w.message)).toEqual(['Ana Example has asked for leave on Wed 11 Nov']);

    await http().post(`/leave/${req.body.id}/approve`).set(as('alloc')).expect(403);
    const ok = await http().post(`/leave/${req.body.id}/approve`).set(as('admin')).expect(200);
    expect(ok.body.status).toBe('approved');
    expect(ok.body.rostered).toHaveLength(1);
    await http().post(`/leave/${req.body.id}/approve`).set(as('admin')).expect(409);

    ana2 = (await candidates(s2)).find(x => x.name === 'Ana Example')!;
    expect(ana2.eligible).toBe(false);
    expect(ana2.blocks.map(b => b.message)).toEqual(['Ana Example is on leave on Wed 11 Nov']);
    const no = await http().post(`/shifts/${s2}/assign`).set(as('alloc')).send({ workerId: ana }).expect(409);
    expect(no.body.message).toBe('Ana Example is on leave on Wed 11 Nov');
    // Bank fill can't offer it to her either.
    await http().post(`/shifts/${s2}/offers`).set(as('alloc')).send({ workerIds: [ana], notify: false }).expect(409);

    // The roster carries leave for its leave lines.
    const r = await http().get('/roster?from=2026-11-09&to=2026-11-15').set(as('alloc')).expect(200);
    expect(r.body.leave).toEqual([{ id: req.body.id, workerId: ana, kind: 'annual', status: 'approved', startsOn: '2026-11-09', endsOn: '2026-11-13' }]);

    const list = await http().get('/leave?from=2026-11-01&to=2026-11-30').set(as('alloc')).expect(200);
    expect(list.body.map((l: { id: string }) => l.id)).toEqual([req.body.id]);

    // Cancelled leave stops blocking; it's kept as a record.
    await http().post(`/leave/${req.body.id}/cancel`).set(as('admin')).expect(200);
    expect((await candidates(s2)).find(x => x.name === 'Ana Example')!.eligible).toBe(true);
    expect((await http().get('/leave?status=cancelled&from=2026-11-01&to=2026-11-30').set(as('alloc')).expect(200)).body).toHaveLength(1);
    const d = await http().post(`/workers/${ben}/leave`).set(as('alloc')).send({ kind: 'unpaid', startsOn: '2026-11-20', endsOn: '2026-11-20' }).expect(201);
    expect((await http().post(`/leave/${d.body.id}/decline`).set(as('admin')).expect(200)).body.status).toBe('declined');
  });

  it("keeps each business's availability and leave to itself", async () => {
    await http().get(`/workers/${ana}/availability`).set(as('other')).expect(404);
    await http().post(`/workers/${ana}/leave`).set(as('other')).send({ kind: 'annual', startsOn: '2026-12-01', endsOn: '2026-12-02' }).expect(404);
    expect((await http().get('/leave?from=2026-11-01&to=2026-11-30').set(as('other')).expect(200)).body).toEqual([]);
    const app = new Client({ connectionString: db.appUrl });
    await app.connect();
    try {
      // Without a tenant set, crop_app sees nothing (row-level security), and it can't delete leave.
      expect((await app.query('select count(*)::int as n from leave_records')).rows[0].n).toBe(0);
      expect((await app.query('select count(*)::int as n from availability_patterns')).rows[0].n).toBe(0);
      await expect(app.query('delete from leave_records')).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});
