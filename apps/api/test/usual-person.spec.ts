import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { changeSummary } from '../src/roster/publishing.js';
import { startFakeIdp } from './fake-idp.js';

// Mondays well in the future, so the weeks are never history while these tests run.
const SOURCE = '2031-06-02';
const TARGET = '2031-06-09';
const LATER = '2031-06-16';

type S = { id: string; equipmentOnly: boolean; localDate: string; localStart: string; workerId: string | null; usualWorkerId: string | null; usualName: string | null; usualAway: string | null };

describe('usual person: the automatic "T" line (David, 3 Nov)', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, ana: string, ben: string, cal: string, otherZoe: string, gear: string, templateId: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_usual_person');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const tenantId = t.rows.find(r => r.slug === 'cafe')!.id;
    const otherId = t.rows.find(r => r.slug === 'other')!.id;
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
    await http().post('/facilities').set(as('other')).send({ name: 'Elsewhere', state: 'VIC' }).expect(201);
    const person = async (firstName: string, who = 'admin') => {
      const id = (await http().post('/workers').set(as(who)).send({ firstName, lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id;
      await http().put(`/workers/${id}/right-to-work`).set(as(who)).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${id}/right-to-work/verify`).set(as(who)).send({}).expect(201);
      return id as string;
    };
    ana = await person('Ana');
    ben = await person('Ben');
    cal = await person('Cal');
    otherZoe = await person('Zoe', 'other');
    // Source week: Ana Monday to Wednesday mornings, Ben Thursday morning.
    const ids = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Chef', startDate: SOURCE, endDate: '2031-06-04', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids;
    for (const id of ids) await http().post(`/shifts/${id}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    const thu = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date: '2031-06-05', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
    await http().post(`/shifts/${thu}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);
    gear = (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, equipmentOnly: true, date: SOURCE, startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  const plus6 = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const week = async (from: string) => ((await http().get(`/roster?from=${from}&to=${plus6(from)}&facilityId=${site}`).set(as('alloc')).expect(200)).body.shifts as S[])
    .filter(s => s.localStart === '07:00' && !s.equipmentOnly).sort((a, b) => a.localDate.localeCompare(b.localDate));
  const on = (list: S[], d: string) => list.find(s => s.localDate === d)!;

  it('describes the change in plain words', () => {
    const base = { workerName: 'Ana Example', equipmentName: null, detail: null, via: 'office' };
    expect(changeSummary({ ...base, kind: 'usual_set' })).toBe('Usually worked by Ana Example');
    expect(changeSummary({ ...base, kind: 'usual_cleared' })).toBe('Ana Example no longer the usual person');
  });

  it('a shift made by hand has no usual person; the office can set and clear one, and it is logged', async () => {
    const [mon] = await week(SOURCE);
    expect(mon).toMatchObject({ usualWorkerId: null, usualName: null, usualAway: null });
    const r = await http().put(`/shifts/${mon.id}/usual`).set(as('alloc')).send({ workerId: ana }).expect(200);
    expect(r.body).toMatchObject({ usualWorkerId: ana, usualName: 'Ana Example', usualAway: null, workerId: ana });
    // The same again changes nothing.
    await http().put(`/shifts/${mon.id}/usual`).set(as('alloc')).send({ workerId: ana }).expect(200);
    await http().put(`/shifts/${mon.id}/usual`).set(as('alloc')).send({ workerId: null }).expect(200);
    const history = (await http().get(`/shifts/${mon.id}/history`).set(as('alloc')).expect(200)).body as { kind: string; summary: string }[];
    expect(history.filter(c => c.kind.startsWith('usual')).map(c => c.summary)).toEqual(['Usually worked by Ana Example', 'Ana Example no longer the usual person']);
  });

  it("refuses equipment-only shifts, another business's person, workers and other businesses", async () => {
    const [mon] = await week(SOURCE);
    await http().put(`/shifts/${gear}/usual`).set(as('alloc')).send({ workerId: ana }).expect(400);
    const other = await http().put(`/shifts/${mon.id}/usual`).set(as('alloc')).send({ workerId: otherZoe }).expect(400);
    expect(other.body.message).toBe('Choose a person who is active');
    await http().put(`/shifts/${mon.id}/usual`).set(as('alloc')).send({ workerId: 'nope' }).expect(400);
    await http().put(`/shifts/${mon.id}/usual`).set(as('worker')).send({ workerId: ana }).expect(403);
    await http().put(`/shifts/${mon.id}/usual`).set(as('other')).send({ workerId: otherZoe }).expect(404);
  });

  it('saving a week as a template keeps who works each shift; applying it sets the usual person', async () => {
    const t = await http().post('/roster/templates').set(as('alloc')).send({ facilityId: site, weekStart: SOURCE, name: 'Usual week', equipment: false }).expect(201);
    expect(t.body).toMatchObject({ shifts: 5, withPeople: 4 });
    templateId = t.body.id;
    // Ana is on approved leave on the Tuesday of the target week and has asked for the Wednesday; Ben can't do mornings on Thursday.
    await http().post(`/workers/${ana}/leave`).set(as('admin')).send({ kind: 'personal', startsOn: '2031-06-10', endsOn: '2031-06-10' }).expect(201);
    await http().post(`/workers/${ana}/leave`).set(as('alloc')).send({ kind: 'annual', startsOn: '2031-06-11', endsOn: '2031-06-11' }).expect(201);
    await http().put(`/workers/${ben}/availability/dates/2031-06-12`).set(as('alloc')).send({ periods: ['pm'] }).expect(200);
    const r = await http().post(`/roster/templates/${templateId}/apply`).set(as('alloc')).send({ weekStart: TARGET }).expect(200);
    expect(r.body.created).toBe(5);
    const [mon, tue, wed, thu] = await week(TARGET);
    expect(mon).toMatchObject({ usualWorkerId: ana, usualName: 'Ana Example', usualAway: null, workerId: ana });
    // On leave: the usual person stays on the T line even though nobody could be put on.
    expect(tue).toMatchObject({ usualWorkerId: ana, usualAway: 'on_leave', workerId: null });
    expect(wed).toMatchObject({ usualWorkerId: ana, usualAway: 'leave_requested', workerId: ana });
    expect(thu).toMatchObject({ usualWorkerId: ben, usualAway: 'not_available' });
    // Never the kind of leave anywhere in the shift.
    expect(JSON.stringify([tue, wed])).not.toMatch(/personal|annual/);
  });

  it('copying a week carries the usual person, and puts them back on before whoever covered', async () => {
    // In the target week Cal worked Tuesday while Ana was on leave.
    const tue = on(await week(TARGET), '2031-06-10');
    await http().post(`/shifts/${tue.id}/assign`).set(as('alloc')).send({ workerId: cal }).expect(200);
    const r = await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: site, toWeek: LATER }).expect(200);
    expect(r.body.created).toBe(5);
    const copied = await week(LATER);
    // Tuesday: Ana is usual again and back on (she's not on leave that week), not Cal.
    expect(on(copied, '2031-06-17')).toMatchObject({ usualWorkerId: ana, workerId: ana, usualAway: null });
    expect(on(copied, '2031-06-19')).toMatchObject({ usualWorkerId: ben, workerId: ben });
    // A copied week saved as a template keeps the usual person rather than whoever covered.
    const t2 = await http().post('/roster/templates').set(as('alloc')).send({ facilityId: site, weekStart: TARGET, name: 'From target' }).expect(201);
    const one = (await http().get(`/roster/templates/${t2.body.id}`).set(as('alloc')).expect(200)).body;
    expect(one.shiftList.filter((s: { workerName: string | null }) => s.workerName).map((s: { weekday: number; workerName: string }) => [s.weekday, s.workerName]))
      .toEqual([[1, 'Ana Example'], [2, 'Ana Example'], [3, 'Ana Example'], [4, 'Ben Example']]);
  });

  it('when the usual person cannot work it, the person who worked the source shift is tried next', async () => {
    // Ana on leave on Tuesday 24 June: copying LATER (Ana on Tuesday, usual Ana) can't put her on and nobody else worked it.
    await http().post(`/workers/${ana}/leave`).set(as('admin')).send({ kind: 'annual', startsOn: '2031-06-24', endsOn: '2031-06-24' }).expect(201);
    // Make Cal the one working Tuesday in LATER while Ana stays the usual person.
    const tue = on(await week(LATER), '2031-06-17');
    await http().post(`/shifts/${tue.id}/unassign`).set(as('alloc')).send({}).expect(200);
    await http().post(`/shifts/${tue.id}/assign`).set(as('alloc')).send({ workerId: cal }).expect(200);
    const r = await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: site, toWeek: '2031-06-23' }).expect(200);
    expect(r.body.leftOpen).toEqual([]);
    expect(on(await week('2031-06-23'), '2031-06-24')).toMatchObject({ usualWorkerId: ana, usualAway: 'on_leave', workerId: cal });
  });
});
