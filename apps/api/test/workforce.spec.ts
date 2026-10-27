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

const AUDIENCE = 'crop-project-id';

describe('workers, credentials and compliance', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const http = () => request(app.getHttpServer());
  const today = todayIn('Australia/Melbourne');

  beforeAll(async () => {
    db = await createTestDatabase('crop_workforce');
    idp = await startFakeIdp(AUDIENCE);
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cfy','Demo'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(
      `insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'wk@x.com','worker'),($2,'other@x.com','owner')`,
      [id('cfy'), id('other')],
    );
    await owner.end();
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['wk', 'wk@x.com'], ['other', 'other@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tokens[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    process.env.APP_DATABASE_URL = db.appUrl;
    process.env.AUTH_ISSUER = idp.issuer;
    process.env.AUTH_AUDIENCE = AUDIENCE;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  let types: Record<string, string> = {};
  let workerId = '';

  it('adds the starter credential types and suggested rules once', async () => {
    const first = await http().post('/credential-types/starter-set').set(as('admin')).expect(201);
    expect(first.body).toEqual({ typesAdded: 11, rulesAdded: 3 });
    const again = await http().post('/credential-types/starter-set').set(as('admin')).expect(201);
    expect(again.body).toEqual({ typesAdded: 0, rulesAdded: 0 });
    const list = await http().get('/credential-types').set(as('alloc')).expect(200);
    types = Object.fromEntries(list.body.map((t: { name: string; id: string }) => [t.name, t.id]));
    expect(Object.keys(types)).toContain('AHPRA registration');
    const rules = await http().get('/credential-requirements').set(as('alloc')).expect(200);
    expect(rules.body).toHaveLength(3);
  });

  it('only lets owners and admins change credential types and rules', async () => {
    await http().post('/credential-types/starter-set').set(as('alloc')).expect(403);
    await http().post('/credential-types').set(as('alloc')).send({ name: 'X', category: 'check' }).expect(403);
    await http().get('/credential-types').set(as('wk')).expect(403);
    await http().post('/credential-types').set(as('admin')).send({ name: 'ahpra REGISTRATION', category: 'registration' }).expect(400);
  });

  it('creates and finds workers, and keeps them inside the agency', async () => {
    const res = await http().post('/workers').set(as('alloc'))
      .send({ firstName: 'Priya', lastName: 'Sharma', email: 'Priya@Example.com', roles: ['RN', 'RN', ' '] }).expect(201);
    workerId = res.body.id;
    expect(res.body).toMatchObject({ email: 'priya@example.com', roles: ['RN'], status: 'active' });
    await http().post('/workers').set(as('alloc')).send({ firstName: 'Dup', lastName: 'X', email: 'priya@example.com' }).expect(400);
    await http().post('/workers').set(as('alloc')).send({ lastName: 'NoFirst' }).expect(400);
    const found = await http().get('/workers?search=shar').set(as('alloc')).expect(200);
    expect(found.body.map((w: { lastName: string }) => w.lastName)).toEqual(['Sharma']);
    await http().get(`/workers/${workerId}`).set(as('other')).expect(404);
    const otherList = await http().get('/workers').set(as('other')).expect(200);
    expect(otherList.body).toEqual([]);
  });

  it('shows a new RN as non-compliant with each missing hard requirement', async () => {
    const res = await http().get(`/workers/${workerId}`).set(as('alloc')).expect(200);
    expect(res.body.compliance).toBe('non_compliant');
    expect(res.body.issues.map((i: { typeName: string; problem: string }) => `${i.typeName}:${i.problem}`).sort()).toEqual([
      'AHPRA registration:missing', 'National Police Check:missing', 'Right to work:missing',
    ]);
  });

  it('records credentials, which count only once verified', async () => {
    const add = (type: string, body: object) =>
      http().post(`/workers/${workerId}/credentials`).set(as('alloc')).send({ credentialTypeId: types[type], ...body });
    await add('AHPRA registration', { number: 'NMW0001234567' }).expect(400); // expiry required
    await add('AHPRA registration', { number: 'NMW0001234567', issueDate: '2026-06-01', expiryDate: '2026-05-01' }).expect(400);
    await add('AHPRA registration', { number: 'NMW0001234567', expiryDate: '2026-02-30' }).expect(400);
    const ids: Record<string, string> = {};
    for (const [type, number] of [['AHPRA registration', 'NMW0001234567'], ['National Police Check', 'NPC-998']]) {
      const r = await add(type, { number, expiryDate: addDays(today, 400) }).expect(201);
      expect(r.body).toMatchObject({ verification: 'unverified', evidence: 'missing' });
      ids[type] = r.body.id;
    }
    await http().put(`/workers/${workerId}/right-to-work`).set(as('alloc')).send({ status: 'citizen', citizenProofType: 'au_passport', documentNumber: 'PA1234567' }).expect(200);
    let w = await http().get(`/workers/${workerId}`).set(as('alloc')).expect(200);
    expect(w.body.compliance).toBe('non_compliant');
    expect(w.body.issues.every((i: { problem: string }) => i.problem === 'unverified')).toBe(true);

    await http().post(`/workers/${workerId}/right-to-work/verify`).set(as('alloc')).send({}).expect(403);
    await http().post(`/workers/${workerId}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    for (const id of Object.values(ids)) {
      await http().post(`/workers/${workerId}/credentials/${id}/verify`).set(as('admin')).send({ note: 'Checked' }).expect(201);
    }
    w = await http().get(`/workers/${workerId}`).set(as('alloc')).expect(200);
    expect(w.body).toMatchObject({ compliance: 'compliant', issues: [] });

    // Changing the expiry of a verified credential needs it verified again, and is recorded in its history.
    await http().patch(`/workers/${workerId}/credentials/${ids['National Police Check']}`).set(as('alloc'))
      .send({ expiryDate: addDays(today, 10) }).expect(200);
    w = await http().get(`/workers/${workerId}`).set(as('alloc')).expect(200);
    expect(w.body.issues).toMatchObject([{ typeName: 'National Police Check', problem: 'unverified' }]);
    await http().post(`/workers/${workerId}/credentials/${ids['National Police Check']}/verify`).set(as('admin')).send({}).expect(201);
    w = await http().get(`/workers/${workerId}`).set(as('alloc')).expect(200);
    expect(w.body).toMatchObject({ compliance: 'expiring', issues: [{ problem: 'expiring' }] });
    const history = await http().get(`/workers/${workerId}/credentials/${ids['National Police Check']}/history`).set(as('alloc')).expect(200);
    expect(history.body.map((e: { action: string }) => e.action)).toEqual(['created', 'verified', 'updated', 'verification_reset', 'verified']);

    // Rejecting needs a reason.
    await http().post(`/workers/${workerId}/right-to-work/reject`).set(as('admin')).send({}).expect(400);
    await http().post(`/workers/${workerId}/right-to-work/reject`).set(as('admin')).send({ reason: 'Wrong document' }).expect(201);
    w = await http().get(`/workers/${workerId}`).set(as('alloc')).expect(200);
    expect(w.body.issues[0]).toMatchObject({ typeName: 'Right to work', problem: 'rejected' });
  });

  it('summarises compliance for the dashboard', async () => {
    await http().post('/workers').set(as('alloc')).send({ firstName: 'Tom', lastName: 'Nguyen', roles: ['AIN'] }).expect(201);
    const res = await http().get('/compliance/summary').set(as('alloc')).expect(200);
    expect(res.body.activeWorkers).toBe(2);
    expect(res.body.counts).toEqual({ compliant: 0, expiring: 0, non_compliant: 2 });
    expect(res.body.expiringSoon.map((c: { typeName: string }) => c.typeName)).toEqual(['National Police Check']);
    const filtered = await http().get('/workers?compliance=non_compliant').set(as('alloc')).expect(200);
    expect(filtered.body).toHaveLength(2);
  });

  it('lets admins change the expiring window and time zone', async () => {
    await http().patch('/settings').set(as('alloc')).send({ expiringWindowDays: 60 }).expect(403);
    await http().patch('/settings').set(as('admin')).send({ timezone: 'Mars/Base' }).expect(400);
    const res = await http().patch('/settings').set(as('admin')).send({ expiringWindowDays: 5 }).expect(200);
    expect(res.body).toEqual({ expiringWindowDays: 5, timezone: 'Australia/Melbourne', country: 'AU', smsMonthlyCap: 2000, minRestHours: 10, publishedChanges: 'open' });
  });
});
