import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { normaliseAbn } from '../src/clients/abn.js';
import { configureApp } from '../src/configure.js';
import { startFakeIdp } from './fake-idp.js';

describe('ABN check', () => {
  it('accepts valid ABNs with or without spaces and rejects others', () => {
    expect(normaliseAbn('51 824 753 556')).toBe('51824753556'); // ATO's published example
    expect(normaliseAbn('51824753557')).toBeNull();
    expect(normaliseAbn('1234')).toBeNull();
  });
});

describe('clients, facilities and areas', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = await createTestDatabase('crop_clients_api');
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

  it('creates a client with a facility (time zone from the state) and areas', async () => {
    await http().post('/clients').set(as('alloc')).send({ name: 'Nope' }).expect(403);
    await http().post('/clients').set(as('admin')).send({ name: 'Bad', abn: '123' }).expect(400);
    const client = await http().post('/clients').set(as('admin')).send({ name: 'Northside Health', abn: '51 824 753 556', billingEmail: 'Accounts@Northside.example' }).expect(201);
    expect(client.body).toMatchObject({ abn: '51824753556', billingEmail: 'accounts@northside.example', status: 'active' });
    await http().post('/clients').set(as('admin')).send({ name: 'northside health' }).expect(400);

    const f = await http().post('/facilities').set(as('admin'))
      .send({ clientId: client.body.id, name: 'Northside Private', addressLine: '1 Main St', suburb: 'Perth', state: 'WA', postcode: '6000' }).expect(201);
    expect(f.body).toMatchObject({ clientName: 'Northside Health', timezone: 'Australia/Perth', state: 'WA' });
    await http().post('/facilities').set(as('admin')).send({ name: 'X', postcode: '60' }).expect(400);

    await http().post(`/facilities/${f.body.id}/areas`).set(as('admin')).send({ name: 'ICU', specialty: 'Intensive Care' }).expect(201);
    await http().post(`/facilities/${f.body.id}/areas`).set(as('admin')).send({ name: 'icu' }).expect(400);
    const detail = await http().get(`/facilities/${f.body.id}`).set(as('alloc')).expect(200);
    expect(detail.body.areas).toMatchObject([{ name: 'ICU', specialty: 'Intensive Care', active: true }]);

    const c = await http().get(`/clients/${client.body.id}`).set(as('alloc')).expect(200);
    expect(c.body.facilities).toMatchObject([{ name: 'Northside Private', areaCount: 1 }]);
    const list = await http().get('/clients').set(as('alloc')).expect(200);
    expect(list.body).toMatchObject([{ name: 'Northside Health', facilityCount: 1 }]);
  });

  it("keeps clients private to each agency and won't link another agency's client", async () => {
    const mine = await http().get('/clients').set(as('admin')).expect(200);
    await http().get(`/clients/${mine.body[0].id}`).set(as('other')).expect(404);
    await http().post('/facilities').set(as('other')).send({ name: 'Sneaky', clientId: mine.body[0].id }).expect(400);
  });

  it('updates a client and a facility, and an explicit time zone overrides the state', async () => {
    const [client] = (await http().get('/clients').set(as('admin'))).body;
    const u = await http().patch(`/clients/${client.id}`).set(as('admin')).send({ status: 'on_hold', abn: null }).expect(200);
    expect(u.body).toMatchObject({ status: 'on_hold', abn: null });
    const [f] = (await http().get('/facilities').set(as('admin'))).body;
    const moved = await http().patch(`/facilities/${f.id}`).set(as('admin')).send({ state: 'NSW', suburb: 'Broken Hill', timezone: 'Australia/Broken_Hill' }).expect(200);
    expect(moved.body).toMatchObject({ state: 'NSW', timezone: 'Australia/Broken_Hill' });
  });
});
