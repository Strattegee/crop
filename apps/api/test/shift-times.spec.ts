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
import { startFakeIdp } from './fake-idp.js';

describe('changing a shift\'s times', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site = '', ana = '', day = '', first = '', second = '';

  beforeAll(async () => {
    db = await createTestDatabase('crop_shift_times');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('care','Demo Care'),('other','Other') returning id`);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [t.rows[0].id, t.rows[1].id]);
    for (const [sub, email] of [['alloc', 'alloc@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    await http().get('/me').set(as('alloc')).expect(200);
    site = (await owner.query<{ id: string }>(`insert into facilities(tenant_id, name, timezone) values ($1,'Bayside House','Australia/Melbourne') returning id`, [t.rows[0].id])).rows[0].id;
    ana = (await owner.query<{ id: string }>(`insert into workers(tenant_id, first_name, last_name, roles) values ($1,'Ana','Example','{Carer}') returning id`, [t.rows[0].id])).rows[0].id;
    await owner.query(`insert into right_to_work_records(tenant_id, worker_id, status, citizen_proof_type, verification) values ($1,$2,'citizen','au_passport','verified')`, [t.rows[0].id, ana]);
    await owner.end();
    day = addDays(todayIn('Australia/Melbourne'), 3);
    const add = async (startTime: string, endTime: string) =>
      (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Carer', date: day, startTime, endTime }).expect(201)).body.ids[0] as string;
    first = await add('09:00', '17:00');
    second = await add('18:00', '22:00');
    for (const s of [first, second]) await http().post(`/shifts/${s}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('moves a shift to new times and logs it', async () => {
    const s = (await http().put(`/shifts/${first}/times`).set(as('alloc')).send({ startTime: '08:00', endTime: '16:00', breakMinutes: 30 }).expect(200)).body;
    expect(s).toMatchObject({ localDate: day, localStart: '08:00', localEnd: '16:00', breakMinutes: 30, workerId: ana });
    const h = (await http().get(`/shifts/${first}/history`).set(as('alloc')).expect(200)).body as Array<{ kind: string }>;
    expect(h.some(x => x.kind === 'times_changed')).toBe(true);
  });

  it('refuses times the person on it can\'t do, and changes nothing', async () => {
    const r = await http().put(`/shifts/${first}/times`).set(as('alloc')).send({ startTime: '08:00', endTime: '19:00' }).expect(409);
    expect(r.body.message).toMatch(/^Ana Example can't work the new times: .*Take them off first/);
    const s = (await http().get(`/shifts/${first}`).set(as('alloc')).expect(200)).body;
    expect(s.localEnd).toBe('16:00');
  });

  it('runs overnight when the end is before the start, and moves days', async () => {
    const s = (await http().put(`/shifts/${second}/times`).set(as('alloc')).send({ date: addDays(day, 1), startTime: '22:00', endTime: '06:00' }).expect(200)).body;
    expect(s).toMatchObject({ localDate: addDays(day, 1), localStart: '22:00', localEnd: '06:00' });
  });

  it('checks its input and other businesses', async () => {
    await http().put(`/shifts/${first}/times`).set(as('alloc')).send({ startTime: '08:00' }).expect(400);
    await http().put(`/shifts/${first}/times`).set(as('alloc')).send({ startTime: '08:00', endTime: '08:00' }).expect(400);
    await http().put(`/shifts/${first}/times`).set(as('alloc')).send({ date: addDays(day, -10), startTime: '08:00', endTime: '10:00' }).expect(400);
    await http().put(`/shifts/${first}/times`).set(as('other')).send({ startTime: '08:00', endTime: '10:00' }).expect(404);
    await http().post(`/shifts/${second}/cancel`).set(as('alloc')).send({ reason: 'Not needed' }).expect((r) => { if (r.status >= 300) throw new Error(String(r.status)); });
    await http().put(`/shifts/${second}/times`).set(as('alloc')).send({ startTime: '08:00', endTime: '10:00' }).expect(400);
  });
});
