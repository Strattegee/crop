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

const AUDIENCE = 'crop-project-id';

describe('CROP API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = await createTestDatabase('crop_api');
    idp = await startFakeIdp(AUDIENCE);
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(
      `insert into tenants(slug, name) values ('cfy','Demo Agency'),('other','Other Agency') returning id, slug`,
    );
    const id = (slug: string) => t.rows.find(r => r.slug === slug)!.id;
    await owner.query(
      `insert into invitations(tenant_id, email, role) values
        ($1,'admin@example.com','admin'), ($1,'worker@example.com','worker'),
        ($1,'multi@example.com','allocator'), ($2,'multi@example.com','owner'),
        ($1,'unverified@example.com','admin')`,
      [id('cfy'), id('other')],
    );
    await owner.end();
    idp.addUser({ sub: 'u-admin', email: 'admin@example.com', email_verified: true, name: 'Alex Admin' });
    idp.addUser({ sub: 'u-worker', email: 'worker@example.com', email_verified: true });
    idp.addUser({ sub: 'u-multi', email: 'multi@example.com', email_verified: true });
    idp.addUser({ sub: 'u-unverified', email: 'unverified@example.com', email_verified: false });
    idp.addUser({ sub: 'u-nobody', email: 'nobody@example.com', email_verified: true });

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

  const bearer = async (sub: string) => `Bearer ${await idp.token(sub)}`;

  it('reports health without signing in', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('requires sign-in', async () => {
    await http().get('/facilities').expect(401);
    await http().get('/me').expect(401);
  });

  it('rejects tokens that are forged, expired, for another audience or from another issuer', async () => {
    const good = await idp.token('u-admin');
    const forged = good.slice(0, -4) + 'AAAA';
    await http().get('/me').set('authorization', `Bearer ${forged}`).expect(401);
    await http().get('/me').set('authorization', `Bearer ${await idp.token('u-admin', { expiresIn: '-1m' })}`).expect(401);
    await http().get('/me').set('authorization', `Bearer ${await idp.token('u-admin', { aud: 'someone-else' })}`).expect(401);
    await http().get('/me').set('authorization', `Bearer ${await idp.token('u-admin', { iss: 'https://evil.example' })}`).expect(401);
  });

  it('links an invited user on first sign-in and remembers them', async () => {
    const res = await http().get('/me').set('authorization', await bearer('u-admin')).expect(200);
    expect(res.body).toMatchObject({
      email: 'admin@example.com',
      name: 'Alex Admin',
      memberships: [{ tenantSlug: 'cfy', role: 'admin' }],
    });
    const calls = idp.userinfoCalls;
    await http().get('/me').set('authorization', await bearer('u-admin')).expect(200);
    expect(idp.userinfoCalls).toBe(calls);
  });

  it('gives no agency access when the email is not verified', async () => {
    const res = await http().get('/me').set('authorization', await bearer('u-unverified')).expect(200);
    expect(res.body.memberships).toEqual([]);
    await http().get('/facilities').set('authorization', await bearer('u-unverified')).expect(403);
  });

  it('gives no agency access without an invitation', async () => {
    await http().get('/facilities').set('authorization', await bearer('u-nobody')).expect(403);
  });

  it('lets admins create facilities and allocators list them, but not workers', async () => {
    await http().post('/facilities').set('authorization', await bearer('u-admin')).send({ name: 'Ward 3 North' }).expect(201);
    await http().post('/facilities').set('authorization', await bearer('u-worker')).send({ name: 'Nope' }).expect(403);
    await http().get('/facilities').set('authorization', await bearer('u-worker')).expect(403);
    const res = await http().get('/facilities').set('authorization', await bearer('u-multi')).set('x-tenant', 'cfy').expect(200);
    expect(res.body.map((f: { name: string }) => f.name)).toEqual(['Ward 3 North']);
  });

  it('makes people in several agencies choose one, and only their own', async () => {
    await http().get('/facilities').set('authorization', await bearer('u-multi')).expect(400);
    const other = await http().get('/facilities').set('authorization', await bearer('u-multi')).set('x-tenant', 'other').expect(200);
    expect(other.body).toEqual([]);
    await http().get('/facilities').set('authorization', await bearer('u-admin')).set('x-tenant', 'other').expect(403);
  });

  it('rejects an invalid time zone', async () => {
    await http().post('/facilities').set('authorization', await bearer('u-admin'))
      .send({ name: 'X', timezone: 'Mars/Olympus' }).expect(400);
  });

  it('serves the OpenAPI document', async () => {
    const res = await http().get('/docs-json').expect(200);
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/health', '/facilities', '/me']));
  });
});
