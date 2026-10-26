import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { slugFor } from '../src/platform/platform.controller.js';
import { startFakeIdp } from './fake-idp.js';

describe('platform administration', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = await createTestDatabase('crop_platform_api');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('home','Home Base') returning id`);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'staff@strattegee.test','owner'),($1,'boss@x.test','owner')`, [t.rows[0].id]);
    for (const [sub, email, verified] of [['staff', 'staff@strattegee.test', true], ['boss', 'boss@x.test', true], ['newbie', 'new@x.test', true], ['sneaky', 'victim@x.test', false]] as const) {
      idp.addUser({ sub, email, email_verified: verified });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    // Everyone signs in once; then staff is made a platform admin by the owner-run tool (as invite-cli does).
    for (const w of ['staff', 'boss']) await http().get('/me').set(as(w)).expect(200);
    await owner.query(`insert into platform_admins(user_id) select id from users where email = 'staff@strattegee.test'`);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await owner?.end();
    await db?.drop();
  });

  it('makes short codes from names', () => {
    expect(slugFor('The Grand Café')).toBe('the-grand-cafe');
    expect(slugFor('  A&B Labour Hire!! ')).toBe('a-b-labour-hire');
  });

  it('only platform admins can use it, and the app cannot make platform admins', async () => {
    expect((await http().get('/me').set(as('staff')).expect(200)).body.platformAdmin).toBe(true);
    expect((await http().get('/me').set(as('boss')).expect(200)).body.platformAdmin).toBe(false);
    await http().get('/platform/businesses').set(as('boss')).expect(403);
    await http().post('/platform/businesses').set(as('boss')).send({ name: 'Nope' }).expect(403);
    const app_ = new Client({ connectionString: db.appUrl });
    await app_.connect();
    await expect(app_.query(`select * from platform_admins`)).rejects.toThrow();
    await expect(app_.query(`select * from platform_admin_events`)).rejects.toThrow();
    await app_.end();
  });

  it('adds a business with its first owner, who gets in at their first verified sign-in', async () => {
    const b = await http().post('/platform/businesses').set(as('staff')).send({ name: 'The Grand Café', ownerEmail: 'New@X.test' }).expect(201);
    expect(b.body.slug).toBe('the-grand-cafe');
    const again = await http().post('/platform/businesses').set(as('staff')).send({ name: 'The Grand Cafe' }).expect(201);
    expect(again.body.slug).toBe('the-grand-cafe-2');
    const detail = await http().get(`/platform/businesses/${b.body.id}`).set(as('staff')).expect(200);
    expect(detail.body.people).toEqual([expect.objectContaining({ status: 'invited', email: 'new@x.test', role: 'owner' })]);
    const me = await http().get('/me').set(as('newbie')).expect(200);
    expect(me.body.memberships.map((m: { tenantSlug: string }) => m.tenantSlug)).toEqual(['the-grand-cafe']);
  });

  it('someone who already belongs to a business picks up a new one without signing out', async () => {
    const list = (await http().get('/platform/businesses').set(as('staff')).expect(200)).body;
    const second = list.find((x: { slug: string }) => x.slug === 'the-grand-cafe-2');
    const r = await http().put(`/platform/businesses/${second.id}/people`).set(as('staff')).send({ email: 'boss@x.test', role: 'admin' }).expect(200);
    expect(r.body.status).toBe('active'); // verified account: straight away
    const me = await http().get('/me').set(as('boss')).expect(200);
    expect(me.body.memberships.map((m: { tenantSlug: string }) => m.tenantSlug).sort()).toEqual(['home', 'the-grand-cafe-2']);
  });

  it('never gives access straight to an unverified account with that email', async () => {
    await http().get('/me').set(as('sneaky')); // signs in with an unverified victim@x.test
    const home = (await http().get('/platform/businesses').set(as('staff')).expect(200)).body.find((x: { slug: string }) => x.slug === 'home');
    const r = await http().put(`/platform/businesses/${home.id}/people`).set(as('staff')).send({ email: 'victim@x.test', role: 'owner' }).expect(200);
    expect(r.body.status).toBe('invited');
    await http().get('/clients').set(as('sneaky')).expect(403);
  });

  it('changes roles and removes access, but never the last owner, and logs every change', async () => {
    const home = (await http().get('/platform/businesses').set(as('staff')).expect(200)).body.find((x: { slug: string }) => x.slug === 'home');
    const people = (await http().get(`/platform/businesses/${home.id}`).set(as('staff')).expect(200)).body.people;
    expect(people.filter((p: { status: string; role: string }) => p.status === 'active' && p.role === 'owner').map((p: { email: string }) => p.email).sort()).toEqual(['boss@x.test', 'staff@strattegee.test']);
    await http().put(`/platform/businesses/${home.id}/people`).set(as('staff')).send({ email: 'boss@x.test', role: 'allocator', change: true }).expect(200);
    const last = await http().delete(`/platform/businesses/${home.id}/people/staff@strattegee.test`).set(as('staff')).expect(400);
    expect(last.body.message).toMatch(/needs an owner/);
    await http().put(`/platform/businesses/${home.id}/people`).set(as('staff')).send({ email: 'staff@strattegee.test', role: 'worker', change: true }).expect(400);
    await http().delete(`/platform/businesses/${home.id}/people/boss@x.test`).set(as('staff')).expect(200);
    await http().delete(`/platform/businesses/${home.id}/people/boss@x.test`).set(as('staff')).expect(404);
    const me = await http().get('/me').set(as('boss')).expect(200);
    expect(me.body.memberships.map((m: { tenantSlug: string }) => m.tenantSlug)).toEqual(['the-grand-cafe-2']);
    const log = await owner.query(`select action from platform_admin_events order by id`);
    expect(log.rows.map(r => r.action)).toEqual(['create_business', 'invite', 'create_business', 'invite', 'invite', 'set_role', 'remove']);
  });
});
