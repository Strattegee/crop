import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { withTenant } from '@crop/db';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { callLine, callProblem } from '../src/clients/calls.js';
import { CANCEL_KINDS, CLIENT_CANCEL_KINDS } from '../src/roster/cancel.js';
import { startFakeIdp } from './fake-idp.js';

describe('cancel reasons and calls: rules (David, 3 Nov)', () => {
  it('has the five cancel kinds, two of them the client’s', () => {
    expect(CANCEL_KINDS).toEqual(['client_cancelled', 'client_withdrew', 'not_filled', 'our_mistake', 'other']);
    expect(CLIENT_CANCEL_KINDS).toEqual(['client_cancelled', 'client_withdrew']);
  });

  it('needs someone on the other end and words a call in one line', () => {
    expect(callProblem({ workerId: null, clientId: null, contactId: null })).toMatch(/Choose who/);
    expect(callProblem({ workerId: 'w', clientId: null, contactId: null })).toBeNull();
    expect(callLine({ outcome: 'said_yes', userName: 'Jo Allocator', time: '14:05', note: 'back Monday' })).toBe('Said yes · Jo Allocator 14:05 · back Monday');
    expect(callLine({ outcome: 'no_answer', userName: 'Jo', time: '09:00', note: null, direction: 'in' })).toBe('No answer (they rang) · Jo 09:00');
  });
});

describe('cancel reasons and calls: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const shift = async (date = ahead(2)) => (await http().post('/shifts').set(as('alloc'))
    .send({ facilityId: ids.site, role: 'Nurse', date, startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0] as string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_calls');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('c4u','Caring Example'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'nosy@x.com','owner')`, [ids.c4u, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: sub === 'alloc' ? 'Jo Allocator' : undefined });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    ids.client = (await http().post('/clients').set(as('admin')).send({ name: 'Bayside Health' }).expect(201)).body.id;
    ids.other = (await http().post('/clients').set(as('admin')).send({ name: 'Hillview Care' }).expect(201)).body.id;
    ids.site = (await http().post('/facilities').set(as('admin')).send({ name: 'Bayside Campus', state: 'VIC', clientId: ids.client }).expect(201)).body.id;
    ids.contact = (await http().post(`/clients/${ids.client}/contacts`).set(as('alloc')).send({ name: 'Pat Ward', email: 'pat@example.com' }).expect(201)).body.id;
    ids.sam = (await http().post('/workers').set(as('admin')).send({ firstName: 'Sam', lastName: 'Example', roles: ['Nurse'], email: 'sam@example.com' }).expect(201)).body.id;
    ids.nosySam = (await http().post('/workers').set(as('nosy')).send({ firstName: 'Nosy', lastName: 'Example', roles: ['Nurse'] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('records why a shift was cancelled, other when not said', async () => {
    const a = await shift();
    const done = (await http().post(`/shifts/${a}/cancel`).set(as('alloc')).send({ reason: 'Ward closed', kind: 'client_cancelled' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'cancelled', cancelledReason: 'Ward closed', cancelKind: 'client_cancelled' });
    const b = await shift();
    expect((await http().post(`/shifts/${b}/cancel`).set(as('alloc')).send({ reason: 'Typed in twice' }).expect(200)).body.cancelKind).toBe('other');
    const c = await shift();
    await http().post(`/shifts/${c}/cancel`).set(as('alloc')).send({ reason: 'x', kind: 'nope' }).expect(400);
    expect((await http().get(`/shifts/${c}`).set(as('alloc')).expect(200)).body).toMatchObject({ status: 'open', cancelKind: null });
    // The change log still records the cancellation; the audit log has the kind.
    const logged = (await owner.query(`select kind, detail from shift_changes where shift_id = $1 and kind = 'cancelled'`, [a])).rows;
    expect(logged).toEqual([{ kind: 'cancelled', detail: 'Ward closed' }]);
    const audited = (await owner.query<{ n: number }>(`select count(*)::int as n from audit_log where table_name = 'shifts' and row_id = $1 and new_values ->> 'cancel_kind' = 'client_cancelled'`, [a])).rows[0].n;
    expect(audited).toBe(1);
    // Only a cancelled shift can carry a kind.
    await expect(owner.query(`update shifts set cancel_kind = 'other' where id = $1`, [c])).rejects.toThrow(/shifts_cancel_kind_only_cancelled/);
  });

  it('carries the kind through a change request to cancel', async () => {
    const monday = (() => { const d = new Date(`${ahead(14)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
    const s = await shift(monday);
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: monday, facilityId: ids.site, notify: false }).expect(201);
    await owner.query(`update tenant_settings set published_changes = 'managers' where tenant_id = $1`, [ids.c4u]);
    await owner.query(`insert into tenant_settings(tenant_id, published_changes) select $1, 'managers' where not exists (select 1 from tenant_settings where tenant_id = $1)`, [ids.c4u]);
    await http().post(`/shifts/${s}/cancel`).set(as('alloc')).send({ reason: 'Client rang', kind: 'client_withdrew' }).expect(409);
    const r = (await http().post(`/shifts/${s}/change-requests`).set(as('alloc')).send({ change: 'cancel', reason: 'Client rang', cancelKind: 'client_withdrew' }).expect(201)).body;
    await http().post(`/change-requests/${r.id}/approve`).set(as('admin')).send({}).expect(200);
    expect((await http().get(`/shifts/${s}`).set(as('admin')).expect(200)).body).toMatchObject({ status: 'cancelled', cancelKind: 'client_withdrew' });
    await owner.query(`update tenant_settings set published_changes = 'open' where tenant_id = $1`, [ids.c4u]);
  });

  it('logs calls with a worker or a client contact, newest first', async () => {
    const s = await shift();
    const one = (await http().post('/calls').set(as('alloc')).send({ workerId: ids.sam, shiftId: s, outcome: 'said_yes', note: 'Happy to do it' }).expect(201)).body;
    expect(one).toMatchObject({ workerName: 'Sam Example', outcome: 'said_yes', outcomeWords: 'Said yes', userName: 'Jo Allocator', shiftId: s, direction: 'out', note: 'Happy to do it' });
    expect(one.localTime).toMatch(/^\d\d:\d\d$/);
    const two = (await http().post('/calls').set(as('admin')).send({ contactId: ids.contact, outcome: 'left_message' }).expect(201)).body;
    expect(two).toMatchObject({ clientId: ids.client, clientName: 'Bayside Health', contactName: 'Pat Ward', workerId: null });
    await http().post('/calls').set(as('alloc')).send({ clientId: ids.client, contactName: 'Someone at reception', outcome: 'answered', direction: 'in' }).expect(201);
    // Refused: nobody, an unknown outcome, a contact with another client, another business's person, a worker.
    await http().post('/calls').set(as('alloc')).send({ outcome: 'answered' }).expect(400);
    await http().post('/calls').set(as('alloc')).send({ workerId: ids.sam, outcome: 'maybe' }).expect(400);
    await http().post('/calls').set(as('alloc')).send({ clientId: ids.other, contactId: ids.contact, outcome: 'answered' }).expect(400);
    await http().post('/calls').set(as('alloc')).send({ workerId: ids.nosySam, outcome: 'answered' }).expect(404);
    await http().post('/calls').set(as('worker')).send({ workerId: ids.sam, outcome: 'answered' }).expect(403);

    const all = (await http().get('/calls').set(as('alloc')).expect(200)).body as { outcome: string }[];
    expect(all.map(c => c.outcome)).toEqual(['answered', 'left_message', 'said_yes']);
    expect((await http().get(`/calls?workerId=${ids.sam}`).set(as('alloc')).expect(200)).body).toHaveLength(1);
    expect((await http().get(`/calls?clientId=${ids.client}`).set(as('alloc')).expect(200)).body).toHaveLength(2);
    expect((await http().get(`/calls?shiftId=${s}`).set(as('alloc')).expect(200)).body).toHaveLength(1);
    await http().get('/calls?days=0').set(as('alloc')).expect(400);
    await http().get('/calls').set(as('worker')).expect(403);
  });

  it('keeps calls to their business and never edits them', async () => {
    expect((await http().get('/calls').set(as('nosy')).expect(200)).body).toEqual([]);
    const pool = new Pool({ connectionString: db.appUrl });
    try {
      expect(await withTenant(pool, ids.nosy, async c => (await c.query('select count(*)::int as n from call_logs')).rows[0].n)).toBe(0);
      await expect(withTenant(pool, ids.c4u, c => c.query(`update call_logs set note = 'changed'`))).rejects.toThrow(/permission denied/);
      await expect(withTenant(pool, ids.c4u, c => c.query('delete from call_logs'))).rejects.toThrow(/permission denied/);
    } finally {
      await pool.end();
    }
  });
});
