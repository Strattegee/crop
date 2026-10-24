import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { DOCUMENT_STORE, MemoryStore } from '../src/documents/document-store.js';
import { addDays, todayIn } from '../src/workforce/compliance.js';
import { startFakeIdp } from './fake-idp.js';

describe('right to work', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const today = todayIn('Australia/Melbourne');
  let base = '';
  let workerId = '';

  beforeAll(async () => {
    db = await createTestDatabase('crop_rtw_api');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cfy','Demo'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [id('cfy'), id('other')]);
    await owner.end();
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DOCUMENT_STORE).useValue(new MemoryStore()).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    workerId = (await http().post('/workers').set(as('alloc')).send({ firstName: 'Mei', lastName: 'Lin' }).expect(201)).body.id;
    base = `/workers/${workerId}/right-to-work`;
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  const compliance = async () => (await http().get(`/workers/${workerId}`).set(as('alloc')).expect(200)).body;

  it('starts missing, and every worker needs it', async () => {
    const r = await http().get(base).set(as('alloc')).expect(200);
    expect(r.body).toMatchObject({ current: null, issue: 'missing', history: [] });
    expect((await compliance()).issues).toMatchObject([{ typeName: 'Right to work', problem: 'missing' }]);
  });

  it('asks for the right details for each status', async () => {
    await http().put(base).set(as('alloc')).send({ status: 'citizen' }).expect(400);
    await http().put(base).set(as('alloc')).send({ status: 'citizen', citizenProofType: 'driver_licence' }).expect(400);
    await http().put(base).set(as('alloc')).send({ status: 'permanent_resident' }).expect(400); // VEVO required
    await http().put(base).set(as('alloc')).send({ status: 'nz_citizen', vevoCheckedOn: addDays(today, 3), vevoResult: 'confirmed' }).expect(400);
    const visa = { status: 'visa_holder', visaType: 'Student', visaSubclass: '500', visaExpiry: addDays(today, 200), vevoCheckedOn: today, vevoResult: 'confirmed' };
    await http().put(base).set(as('alloc')).send(visa).expect(400); // work conditions
    await http().put(base).set(as('alloc')).send({ ...visa, workLimit: 'limited' }).expect(400); // hours
    await http().put(base).set(as('alloc')).send({ ...visa, visaSubclass: 'Student', workLimit: 'unlimited' }).expect(400);
    const ok = await http().put(base).set(as('alloc')).send({ ...visa, workLimit: 'limited', workHoursPerFortnight: 48 }).expect(200);
    expect(ok.body).toMatchObject({ status: 'visa_holder', visaSubclass: '500', workLimit: 'limited', workHoursPerFortnight: 48, verification: 'unverified' });
  });

  it('counts only once verified, and treats an expired visa as no right to work', async () => {
    expect((await compliance()).issues[0]).toMatchObject({ problem: 'unverified' });
    await http().post(`${base}/verify`).set(as('admin')).send({ note: 'VEVO printout checked' }).expect(201);
    expect((await compliance()).compliance).toBe('compliant');

    // New details (visa about to expire) replace the old record, which stays in history, and need verifying again.
    await http().put(base).set(as('alloc')).send({
      status: 'visa_holder', visaType: 'Student', visaSubclass: '500', visaExpiry: addDays(today, 10),
      workLimit: 'limited', workHoursPerFortnight: 48, vevoCheckedOn: today, vevoResult: 'confirmed',
    }).expect(200);
    const r = await http().get(base).set(as('alloc')).expect(200);
    expect(r.body.history).toHaveLength(1);
    expect(r.body.current.verification).toBe('unverified');
    await http().post(`${base}/verify`).set(as('admin')).send({}).expect(201);
    expect((await compliance())).toMatchObject({ compliance: 'expiring', issues: [{ problem: 'expiring' }] });

    await http().put(base).set(as('alloc')).send({ status: 'permanent_resident', vevoCheckedOn: today, vevoResult: 'not_confirmed' }).expect(200);
    expect((await compliance()).issues[0]).toMatchObject({ problem: 'no_work_rights' });
  });

  it('stores documents against the current record, privately', async () => {
    const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
    const doc = await http().post(`${base}/documents`).set(as('alloc')).attach('file', pdf, 'VEVO result.pdf').expect(201);
    const r = await http().get(base).set(as('alloc')).expect(200);
    expect(r.body.current.documents).toMatchObject([{ filename: 'VEVO result.pdf' }]);
    await http().get(`${base}/documents/${doc.body.id}/link`).set(as('alloc')).expect(200);
    await http().get(`${base}/documents/${doc.body.id}/link`).set(as('other')).expect(404);
    await http().delete(`${base}/documents/${doc.body.id}`).set(as('alloc')).expect(200);
    expect((await http().get(base).set(as('alloc'))).body.current.documents).toEqual([]);
  });

  it("keeps other agencies out", async () => {
    await http().get(base).set(as('other')).expect(404);
    await http().put(base).set(as('other')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(404);
  });
});
