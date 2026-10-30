import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { genderReason } from '../src/roster/eligibility.js';
import { changeSummary } from '../src/roster/publishing.js';
import { startFakeIdp } from './fake-idp.js';

// A Monday well in the future, so the week is never history while these tests run.
const WEEK = '2031-06-02';

describe('gender requested on a shift (David, 30 Oct)', () => {
  it('warns about the other gender or none recorded, never when it matches or nothing was asked', () => {
    expect(genderReason('Ana Example', 'F', 'F')).toBeNull();
    expect(genderReason('Ana Example', null, 'M')).toBeNull();
    expect(genderReason('Ana Example', 'F', undefined)).toBeNull();
    expect(genderReason('Ben Example', 'F', 'M')).toEqual({
      code: 'gender', message: 'A female worker was requested for this shift; Ben Example is recorded as male' });
    expect(genderReason('Cal Example', 'M', null)?.message).toBe("A male worker was requested for this shift; Cal Example's gender isn't recorded");
    const base = { workerName: null, equipmentName: null, via: 'office' };
    expect(changeSummary({ ...base, kind: 'gender_changed', detail: 'F' })).toBe('Female worker requested');
    expect(changeSummary({ ...base, kind: 'gender_changed', detail: null })).toBe('Gender request removed');
  });

  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, ana: string, ben: string, cal: string, shift: string, plain: string, gear: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_gender');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('care','Demo Care') returning id`);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker')`, [t.rows[0].id]);
    await owner.end();
    for (const [sub, email] of [['owner', 'owner@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    site = (await http().post('/facilities').set(as('owner')).send({ name: 'Bayside House', state: 'VIC' }).expect(201)).body.id;
    const person = async (firstName: string, gender?: string) => {
      const id = (await http().post('/workers').set(as('owner')).send({ firstName, lastName: 'Example', roles: ['Carer'], gender }).expect(201)).body.id;
      await http().put(`/workers/${id}/right-to-work`).set(as('owner')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${id}/right-to-work/verify`).set(as('owner')).send({}).expect(201);
      return id as string;
    };
    ana = await person('Ana', 'F');
    ben = await person('Ben', 'M');
    cal = await person('Cal');
    [shift, plain] = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Carer', date: WEEK, quantity: 2, startTime: '07:00', endTime: '15:00', genderRequested: 'F' }).expect(201)).body.ids;
    await http().put(`/shifts/${plain}/gender`).set(as('alloc')).send({ genderRequested: null }).expect(200);
    gear = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, equipmentOnly: true, date: WEEK, startTime: '07:00', endTime: '15:00', genderRequested: 'F' }).expect(201)).body.ids[0];
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('records a worker\'s gender (F, M or blank) and refuses anything else', async () => {
    expect((await http().get(`/workers/${ana}`).set(as('alloc')).expect(200)).body.gender).toBe('F');
    expect((await http().patch(`/workers/${cal}`).set(as('alloc')).send({ gender: 'M' }).expect(200)).body.gender).toBe('M');
    expect((await http().patch(`/workers/${cal}`).set(as('alloc')).send({ gender: '' }).expect(200)).body.gender).toBeNull();
    expect((await http().patch(`/workers/${cal}`).set(as('alloc')).send({ firstName: 'Cal' }).expect(200)).body.gender).toBeNull();
    const bad = await http().patch(`/workers/${cal}`).set(as('alloc')).send({ gender: 'X' }).expect(400);
    expect(bad.body.message).toBe('Gender must be one of: F, M');
  });

  it('shifts carry the request; equipment-only shifts never do', async () => {
    const roster = (await http().get(`/roster?from=${WEEK}&to=2031-06-08`).set(as('alloc')).expect(200)).body;
    const find = (id: string) => roster.shifts.find((s: { id: string }) => s.id === id);
    expect(find(shift)).toMatchObject({ genderRequested: 'F', workerGender: null, itemCount: 0 });
    expect(find(plain).genderRequested).toBeNull();
    expect(find(gear).genderRequested).toBeNull();
    await http().put(`/shifts/${gear}/gender`).set(as('alloc')).send({ genderRequested: 'F' }).expect(400);
  });

  it('candidates: the other gender or none recorded is a warning, not a block', async () => {
    const list = (await http().get(`/shifts/${shift}/candidates`).set(as('alloc')).expect(200)).body.candidates as
      Array<{ workerId: string; eligible: boolean; warnings: Array<{ code: string }> }>;
    const of = (id: string) => list.find(c => c.workerId === id)!;
    expect(of(ana).warnings.some(w => w.code === 'gender')).toBe(false);
    expect(of(ben)).toMatchObject({ eligible: true });
    expect(of(ben).warnings.some(w => w.code === 'gender')).toBe(true);
    expect(of(cal).warnings.some(w => w.code === 'gender')).toBe(true);
    const plainList = (await http().get(`/shifts/${plain}/candidates`).set(as('alloc')).expect(200)).body.candidates as Array<{ warnings: Array<{ code: string }> }>;
    expect(plainList.every(c => !c.warnings.some(w => w.code === 'gender'))).toBe(true);
  });

  it('the office can still put the other gender on; changing the request is logged and reports the warning', async () => {
    const r = await http().post(`/shifts/${shift}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);
    expect(r.body.workerGender).toBe('M');
    const changed = await http().put(`/shifts/${shift}/gender`).set(as('alloc')).send({ genderRequested: 'F' }).expect(200);
    expect(changed.body.personWarning).toBe('A female worker was requested for this shift; Ben Example is recorded as male');
    const male = await http().put(`/shifts/${shift}/gender`).set(as('alloc')).send({ genderRequested: 'M' }).expect(200);
    expect(male.body.personWarning).toBeNull();
    const history = (await http().get(`/shifts/${shift}/history`).set(as('alloc')).expect(200)).body as Array<{ kind: string; summary: string }>;
    expect(history.filter(c => c.kind === 'gender_changed').map(c => c.summary)).toEqual(['Male worker requested']);
    await http().put(`/shifts/${shift}/gender`).set(as('worker')).send({ genderRequested: 'F' }).expect(403);
    await http().put(`/shifts/${shift}/gender`).set(as('alloc')).send({ genderRequested: 'female' }).expect(400);
  });

  it('templates and copied weeks keep the request', async () => {
    await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: site, fromWeek: WEEK, toWeek: '2031-06-09', people: false }).expect(200);
    const next = (await http().get('/roster?from=2031-06-09&to=2031-06-15').set(as('alloc')).expect(200)).body.shifts as Array<{ genderRequested: string | null }>;
    expect(next.map(s => s.genderRequested).sort()).toEqual(['M', null, null].sort());
  });

  it('marks vehicles apart from other equipment, for the V and E letters on the card', async () => {
    const ute = (await http().post('/equipment-types').set(as('owner')).send({ name: 'Ute', vehicle: true }).expect(201)).body;
    expect(ute.vehicle).toBe(true);
    const hoist = (await http().post('/equipment-types').set(as('owner')).send({ name: 'Hoist' }).expect(201)).body;
    expect(hoist.vehicle).toBe(false);
    expect((await http().patch(`/equipment-types/${hoist.id}`).set(as('owner')).send({ vehicle: true }).expect(200)).body.vehicle).toBe(true);
    await http().patch(`/equipment-types/${hoist.id}`).set(as('owner')).send({ vehicle: false }).expect(200);
    const car = (await http().post('/equipment').set(as('owner')).send({ equipmentTypeId: ute.id, name: 'Ute 1' }).expect(201)).body.id;
    const lift = (await http().post('/equipment').set(as('owner')).send({ equipmentTypeId: hoist.id, name: 'Hoist 1' }).expect(201)).body.id;
    await http().post(`/shifts/${plain}/equipment`).set(as('alloc')).send({ equipmentId: car }).expect(200);
    await http().post(`/shifts/${plain}/equipment`).set(as('alloc')).send({ equipmentId: lift }).expect(200);
    const roster = (await http().get(`/roster?from=${WEEK}&to=2031-06-08`).set(as('alloc')).expect(200)).body;
    const s = roster.shifts.find((x: { id: string }) => x.id === plain);
    expect(s.equipment.map((e: { name: string; vehicle: boolean }) => [e.name, e.vehicle])).toEqual([['Hoist 1', false], ['Ute 1', true]]);
  });
});
