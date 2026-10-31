import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { auditSummary, fieldLabel } from '../src/audit/audit.js';
import { ExpiryReminders } from '../src/notifications/reminders.js';
import { startFakeIdp } from './fake-idp.js';

describe('audit log wording', () => {
  it('says what changed in plain words', () => {
    expect(fieldLabel('expiry_date')).toBe('Expiry date');
    expect(fieldLabel('credential_type_id')).toBe('Credential type');
    expect(auditSummary({ tableName: 'workers', action: 'update', oldValues: { phone: null }, newValues: { phone: '0400' } })).toBe('Changed Person: phone');
    expect(auditSummary({ tableName: 'leave_records', action: 'insert', oldValues: null, newValues: { id: 'x' } })).toBe('Added Leave');
  });
});

describe('audit log (spec: every create, change and delete, with who, when, old and new values)', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let ana = '';

  beforeAll(async () => {
    db = await createTestDatabase('crop_audit');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('care','Demo Care'),('other','Other') returning id`);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [t.rows[0].id, t.rows[1].id]);
    await owner.end();
    for (const [sub, email, name] of [['owner', 'owner@x.com', 'Olive Owner'], ['alloc', 'alloc@x.com', 'Alice Allocator'], ['other', 'o@x.com', 'Oscar Other']]) {
      idp.addUser({ sub, email, email_verified: true, name });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    for (const w of ['owner', 'alloc', 'other']) await http().get('/me').set(as(w)).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('records who added and changed a record, with only what changed', async () => {
    ana = (await http().post('/workers').set(as('alloc')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Carer'] }).expect(201)).body.id;
    await http().patch(`/workers/${ana}`).set(as('alloc')).send({ phone: '0412 345 678' }).expect(200);
    const log = (await http().get('/audit?table=workers').set(as('owner')).expect(200)).body.rows as Array<{
      action: string; by: string; via: string; summary: string; fields: { key: string; old: unknown; new: unknown }[] }>;
    expect(log[0]).toMatchObject({ action: 'update', by: 'Alice Allocator', via: 'office', summary: 'Changed Person: phone' });
    expect(log[0].fields).toEqual([{ key: 'phone', label: 'Phone', old: null, new: '0412 345 678' }]);
    expect(log[1]).toMatchObject({ action: 'insert', by: 'Alice Allocator', summary: 'Added Person' });
    expect(log[1].fields.some(f => f.key === 'first_name' && f.new === 'Ana')).toBe(true);
  });

  it("lists everything about one person on their own log", async () => {
    const type = (await http().post('/credential-types').set(as('owner')).send({ name: 'First Aid', category: 'training', hasNumber: false, hasExpiry: false }).expect(201)).body.id;
    await http().post(`/workers/${ana}/credentials`).set(as('alloc')).send({ credentialTypeId: type }).expect(201);
    const mine = (await http().get(`/workers/${ana}/audit`).set(as('owner')).expect(200)).body.rows as Array<{ table: string; action: string }>;
    expect(mine.map(r => `${r.table}:${r.action}`)).toEqual(['worker_credentials:insert', 'workers:update', 'workers:insert']);
  });

  it('marks changes made by CROP itself as system', async () => {
    await app.get(ExpiryReminders).runOnce(new Date('2026-01-01T01:00:00Z'));
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    await owner.query(`select 1`);
    await owner.end();
    // Nothing above needed a change; a direct system write (no request) is logged as CROP.
    const appDb = new Client({ connectionString: db.appUrl });
    await appDb.connect();
    const tenant = (await http().get('/me').set(as('owner')).expect(200)).body.memberships[0].tenantId;
    await appDb.query('begin');
    await appDb.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
    await appDb.query(`update workers set notes = 'Prefers mornings' where id = $1`, [ana]);
    await appDb.query('commit');
    const log = (await http().get(`/workers/${ana}/audit`).set(as('owner')).expect(200)).body.rows;
    expect(log[0]).toMatchObject({ by: 'CROP', via: 'system', summary: 'Changed Person: notes' });
    // The log can't be edited or removed by the app.
    await appDb.query('begin');
    await appDb.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
    await expect(appDb.query('update audit_log set actor_name = null')).rejects.toThrow(/permission denied/);
    await appDb.query('rollback');
    await expect(appDb.query('delete from audit_log')).rejects.toThrow(/permission denied/);
    await appDb.end();
  });

  it('only owners and admins read it, and only their own business', async () => {
    await http().get('/audit').set(as('alloc')).expect(403);
    await http().get('/audit?table=nope').set(as('owner')).expect(400);
    const other = (await http().get('/audit').set(as('other')).expect(200)).body.rows as Array<{ table: string; rowId: string }>;
    expect(other.some(r => r.table === 'workers' || r.rowId === ana)).toBe(false); // only its own sign-in
    await http().get(`/workers/${ana}/audit`).set(as('other')).expect(200).then(r => expect(r.body.rows).toEqual([]));
  });
});
