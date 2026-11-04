import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { createPool, withTenant } from '@crop/db';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { addressChangeRefusal, addressLine, parseAddress, sameAddress } from '../src/workforce/addresses.js';
import { startFakeIdp } from './fake-idp.js';

describe('addresses: rules (David, 3 Nov, answer 5)', () => {
  it('reads an address checked against its country', () => {
    const ok = parseAddress({ line1: ' 12  Example Street ', suburb: 'Richmond', state: 'vic', postcode: '3121' }, 'AU');
    expect(ok).toEqual({ address: { label: null, line1: '12 Example Street', line2: null, suburb: 'Richmond', region: 'VIC', postcode: '3121', country: 'AU' } });
    expect(parseAddress({ suburb: 'Richmond' }, 'AU')).toEqual({ problem: 'Enter the street address' });
    expect(parseAddress({ line1: '1 A St', state: 'Victoria' }, 'AU')).toEqual({ problem: 'Choose a state in Australia' });
    expect(parseAddress({ line1: '1 A St', postcode: '312' }, 'AU')).toEqual({ problem: 'Postcode for Australia: 4 digits' });
    expect(parseAddress({ line1: '1 A St', country: 'FR' }, 'AU')).toMatchObject({ problem: expect.stringMatching(/Choose a country/) });
    const uk = parseAddress({ line1: '1 High Street', suburb: 'Leeds', postcode: 'ls11ur', country: 'gb' }, 'AU');
    expect(uk).toMatchObject({ address: { postcode: 'LS1 1UR', country: 'GB' } });
    expect(parseAddress({ line1: 'x'.repeat(201) }, 'AU')).toMatchObject({ problem: expect.stringMatching(/too long/) });
  });

  it('words an address in one line, naming the country only when it is not the business’s', () => {
    const a = { line1: '12 Example Street', line2: 'Unit 3', suburb: 'Richmond', region: 'VIC', postcode: '3121', country: 'AU' as const };
    expect(addressLine(a, 'AU')).toBe('12 Example Street, Unit 3, Richmond VIC 3121');
    expect(addressLine({ ...a, line2: null, region: null, postcode: null }, 'NZ')).toBe('12 Example Street, Richmond, Australia');
  });

  it('spots a correction that changes nothing, and refuses to change history', () => {
    const a = { label: null, line1: '1 A St', line2: null, suburb: null, region: null, postcode: null, country: 'AU' as const };
    expect(sameAddress(a, { ...a })).toBe(true);
    expect(sameAddress(a, { ...a, suburb: 'Kew' })).toBe(false);
    expect(addressChangeRefusal({ replacedAt: null, removedAt: null })).toBeNull();
    expect(addressChangeRefusal({ replacedAt: 'x', removedAt: null })).toMatch(/corrected/);
    expect(addressChangeRefusal({ replacedAt: null, removedAt: 'x' })).toMatch(/taken off/);
  });
});

describe('addresses: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let appPool: Pool;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDatabase('crop_addresses');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('c4u','Caring Example'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'nosy@x.com','owner')`, [ids.c4u, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    appPool = createPool(db.appUrl);
    ids.sam = (await http().post('/workers').set(as('admin')).send({ firstName: 'Sam', lastName: 'Example', roles: ['Nurse'] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await appPool?.end();
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('makes the first address current and keeps the next one on the list', async () => {
    const first = (await http().post(`/workers/${ids.sam}/addresses`).set(as('alloc'))
      .send({ label: 'Home', line1: '12 Example Street', suburb: 'Richmond', state: 'VIC', postcode: '3121' }).expect(201)).body;
    expect(first.current).toMatchObject({ label: 'Home', line: '12 Example Street, Richmond VIC 3121', current: true });
    ids.home = first.current.id;
    const second = (await http().post(`/workers/${ids.sam}/addresses`).set(as('alloc'))
      .send({ label: 'Parents', line1: '4 Sample Road', suburb: 'Geelong', state: 'VIC', postcode: '3220' }).expect(201)).body;
    expect(second.current.id).toBe(ids.home);
    expect(second.others.map((o: { label: string }) => o.label)).toEqual(['Parents']);
    ids.parents = second.others[0].id;
    await http().post(`/workers/${ids.sam}/addresses`).set(as('alloc')).send({ line1: '1 A St', postcode: '12' }).expect(400)
      .expect(r => expect(r.body.message).toBe('Postcode for Australia: 4 digits'));
  });

  it('moves between addresses: the old current one stays on the list', async () => {
    const r = (await http().post(`/worker-addresses/${ids.parents}/current`).set(as('alloc')).expect(200)).body;
    expect(r.current.id).toBe(ids.parents);
    expect(r.others.map((o: { id: string }) => o.id)).toEqual([ids.home]);
    const back = (await http().post(`/worker-addresses/${ids.home}/current`).set(as('alloc')).expect(200)).body;
    expect(back.current.id).toBe(ids.home);
    // A new address can be made current straight away.
    const moved = (await http().post(`/workers/${ids.sam}/addresses`).set(as('alloc'))
      .send({ line1: '9 New Street', suburb: 'Kew', state: 'VIC', postcode: '3101', current: true }).expect(201)).body;
    expect(moved.current.line).toBe('9 New Street, Kew VIC 3101');
    expect(moved.others).toHaveLength(2);
    ids.kew = moved.current.id;
  });

  it('corrects by adding a new version and keeps the old one on file', async () => {
    const r = (await http().post(`/worker-addresses/${ids.kew}/correct`).set(as('alloc')).send({ line1: '19 New Street' }).expect(200)).body;
    expect(r.current).toMatchObject({ line: '19 New Street, Kew VIC 3101', replacesId: ids.kew, current: true });
    expect(r.earlier).toEqual([expect.objectContaining({ id: ids.kew, ended: 'corrected', replacedById: r.current.id, line: '9 New Street, Kew VIC 3101' })]);
    await http().post(`/worker-addresses/${ids.kew}/correct`).set(as('alloc')).send({ line1: '29 New Street' }).expect(409)
      .expect(x => expect(x.body.message).toMatch(/corrected since/));
    await http().post(`/worker-addresses/${ids.kew}/current`).set(as('alloc')).expect(409);
    // Nothing changed: nothing recorded.
    const same = (await http().post(`/worker-addresses/${r.current.id}/correct`).set(as('alloc')).send({ line1: '19 New Street' }).expect(200)).body;
    expect(same.earlier).toHaveLength(1);
    ids.kew2 = r.current.id;
  });

  it('removes from the list but keeps it on file', async () => {
    const r = (await http().post(`/worker-addresses/${ids.parents}/remove`).set(as('alloc')).send({ reason: 'No longer used' }).expect(200)).body;
    expect(r.others.map((o: { id: string }) => o.id)).toEqual([ids.home]);
    expect(r.earlier.find((e: { id: string }) => e.id === ids.parents)).toMatchObject({ ended: 'removed', removedReason: 'No longer used' });
    await http().post(`/worker-addresses/${ids.parents}/remove`).set(as('alloc')).expect(409);
    // Removing the current one leaves none current.
    const none = (await http().post(`/worker-addresses/${ids.kew2}/remove`).set(as('alloc')).expect(200)).body;
    expect(none.current).toBeNull();
  });

  it('keeps every step in the audit log against the person', async () => {
    const log = (await http().get(`/workers/${ids.sam}/audit`).set(as('admin')).expect(200)).body;
    const rows = (log.rows ?? log) as { tableName?: string; summary?: string }[];
    expect(rows.filter(x => x.tableName === 'worker_addresses' || /Address/.test(x.summary ?? '')).length).toBeGreaterThanOrEqual(5);
  });

  it('is for the office of the person’s own business only', async () => {
    await http().get(`/workers/${ids.sam}/addresses`).set(as('worker')).expect(403);
    await http().get(`/workers/${ids.sam}/addresses`).set(as('nosy')).expect(404);
    await http().post(`/worker-addresses/${ids.home}/current`).set(as('nosy')).expect(404);
    const seen = await withTenant(appPool, ids.nosy, async c => (await c.query('select count(*)::int as n from worker_addresses')).rows[0].n);
    expect(seen).toBe(0);
  });

  it('never lets the app edit or delete an address row', async () => {
    await expect(withTenant(appPool, ids.c4u, c => c.query(`update worker_addresses set line1 = 'x' where id = $1`, [ids.home]))).rejects.toThrow(/permission denied/);
    await expect(withTenant(appPool, ids.c4u, c => c.query('delete from worker_addresses where id = $1', [ids.home]))).rejects.toThrow(/permission denied/);
  });
});
