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

// A Monday well in the future, so the week is never history while these tests run.
const WEEK = '2031-05-05';

describe('covering line: the person a shift covers (Steve\'s "T" line)', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, otherSite: string, ana: string, ben: string, otherAna: string;
  let shiftA: string, shiftB: string, gear: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_covering');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const tenantId = t.rows.find(r => r.slug === 'cafe')!.id;
    const otherId = t.rows.find(r => r.slug === 'other')!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`, [tenantId, otherId]);
    await owner.end();
    for (const [sub, email] of [['owner', 'owner@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    site = (await http().post('/facilities').set(as('owner')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    otherSite = (await http().post('/facilities').set(as('other')).send({ name: 'Elsewhere', state: 'VIC' }).expect(201)).body.id;
    const person = async (firstName: string, who = 'owner') => {
      const id = (await http().post('/workers').set(as(who)).send({ firstName, lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id;
      await http().put(`/workers/${id}/right-to-work`).set(as(who)).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${id}/right-to-work/verify`).set(as(who)).send({}).expect(201);
      return id as string;
    };
    ana = await person('Ana');
    ben = await person('Ben');
    otherAna = await person('Zoe', 'other');
    expect(otherSite).toBeTruthy();
    [shiftA, shiftB] = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Chef', startDate: WEEK, endDate: '2031-05-06', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids;
    gear = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, equipmentOnly: true, date: WEEK, startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('describes the change in plain words, never why the person is away', () => {
    const base = { workerName: 'Ana Example', equipmentName: null, detail: null, via: 'office' };
    expect(changeSummary({ ...base, kind: 'covering_set' })).toBe('Covering Ana Example');
    expect(changeSummary({ ...base, kind: 'covering_cleared' })).toBe('No longer covering Ana Example');
  });

  it('the office sets who a shift is covering; the roster shows the name', async () => {
    const r = await http().put(`/shifts/${shiftA}/covering`).set(as('alloc')).send({ workerId: ana }).expect(200);
    expect(r.body).toMatchObject({ coveringWorkerId: ana, coveringName: 'Ana Example' });
    const roster = (await http().get(`/roster?from=${WEEK}&to=2031-05-11`).set(as('alloc')).expect(200)).body;
    expect(roster.shifts.find((s: { id: string }) => s.id === shiftA)).toMatchObject({ coveringName: 'Ana Example' });
    expect(roster.shifts.find((s: { id: string }) => s.id === shiftB).coveringName).toBeNull();
    // Saving the same person again changes nothing (and logs nothing).
    await http().put(`/shifts/${shiftA}/covering`).set(as('alloc')).send({ workerId: ana }).expect(200);
    const history = (await http().get(`/shifts/${shiftA}/history`).set(as('alloc')).expect(200)).body;
    expect(history.map((c: { kind: string }) => c.kind)).toEqual(['created', 'covering_set']);
    expect(history.at(-1).summary).toBe('Covering Ana Example');
  });

  it('can be cleared, and the clearing is logged', async () => {
    await http().put(`/shifts/${shiftA}/covering`).set(as('alloc')).send({ workerId: ben }).expect(200);
    const r = await http().put(`/shifts/${shiftA}/covering`).set(as('alloc')).send({ workerId: null }).expect(200);
    expect(r.body.coveringWorkerId).toBeNull();
    const history = (await http().get(`/shifts/${shiftA}/history`).set(as('alloc')).expect(200)).body;
    expect(history.slice(-2).map((c: { summary: string }) => c.summary)).toEqual(['Covering Ben Example', 'No longer covering Ben Example']);
  });

  it("refuses the person working it, another business's person, equipment-only shifts and workers", async () => {
    await http().post(`/shifts/${shiftB}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);
    const self = await http().put(`/shifts/${shiftB}/covering`).set(as('alloc')).send({ workerId: ben }).expect(400);
    expect(self.body.message).toBe("Ben Example is working this shift, so it can't be covering them");
    await http().put(`/shifts/${shiftB}/covering`).set(as('alloc')).send({ workerId: otherAna }).expect(400);
    await http().put(`/shifts/${shiftB}/covering`).set(as('alloc')).send({ workerId: 'nope' }).expect(400);
    await http().put(`/shifts/${gear}/covering`).set(as('alloc')).send({ workerId: ana }).expect(400);
    await http().put(`/shifts/${shiftB}/covering`).set(as('worker')).send({ workerId: ana }).expect(403);
    await http().put(`/shifts/${shiftB}/covering`).set(as('other')).send({ workerId: otherAna }).expect(404);
  });

  it('putting the covered person back on the shift clears the line', async () => {
    await http().put(`/shifts/${shiftA}/covering`).set(as('alloc')).send({ workerId: ana }).expect(200);
    const r = await http().post(`/shifts/${shiftA}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    expect(r.body).toMatchObject({ workerId: ana, coveringWorkerId: null });
    await http().post(`/shifts/${shiftA}/unassign`).set(as('alloc')).send({}).expect(200);
  });

  it("follows the after-publishing rule and doesn't message the covered person", async () => {
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: WEEK, facilityId: site, notify: false }).expect(201);
    await http().patch('/settings').set(as('owner')).send({ publishedChanges: 'managers' }).expect(200);
    const refused = await http().put(`/shifts/${shiftA}/covering`).set(as('alloc')).send({ workerId: ana }).expect(409);
    expect(refused.body.message).toMatch(/only an owner or admin/);
    await http().put(`/shifts/${shiftA}/covering`).set(as('owner')).send({ workerId: ana }).expect(200);
    const changes = (await http().get(`/roster/changes?weekStart=${WEEK}&facilityId=${site}`).set(as('owner')).expect(200)).body;
    expect(changes.find((c: { kind: string }) => c.kind === 'covering_set')).toMatchObject({ afterPublish: true, summary: 'Covering Ana Example' });
    // Publishing again tells only people whose own shifts changed: Ana isn't on any, so nobody is messaged for this.
    const again = await http().post('/roster/publish').set(as('owner')).send({ weekStart: WEEK, facilityId: site }).expect(201);
    expect(again.body.messages).toBe(0);
  });
});
