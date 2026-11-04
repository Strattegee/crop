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
import { changeRefusal, changeWhat, decidedMessage, parseAsked, sameValue, toApproveEmail, valueLine } from '../src/workforce/detail-changes.js';
import { startFakeIdp } from './fake-idp.js';

describe('detail changes: rules (David, 3 Nov, answer 5)', () => {
  it('refuses what the business keeps, and lets the rest through', () => {
    expect(changeRefusal('gender', 'hidden')).toBe('The office keeps your gender: ask them if it needs changing');
    expect(changeRefusal('address', 'see')).toBe('Ask the office to change your addresses');
    expect(changeRefusal('mobile', 'approve')).toBeNull();
    expect(changeRefusal('mobile', 'change')).toBeNull();
  });

  it('reads each field the way the office does', () => {
    expect(parseAsked('mobile', { value: '0412 345 678' }, 'AU')).toEqual({ asked: { value: '+61412345678' } });
    expect(parseAsked('mobile', { value: '12' }, 'AU')).toMatchObject({ problem: expect.stringMatching(/mobile/i) });
    expect(parseAsked('mobile', { value: '' }, 'AU')).toEqual({ asked: { value: null } });
    expect(parseAsked('name', { firstName: ' Ana ', lastName: 'Sample' }, 'AU')).toEqual({ asked: { firstName: 'Ana', lastName: 'Sample' } });
    expect(parseAsked('name', { firstName: 'Ana' }, 'AU')).toEqual({ problem: 'Enter your first and last name' });
    expect(parseAsked('email', { value: 'Ana@Example.com' }, 'AU')).toEqual({ asked: { value: 'ana@example.com' } });
    expect(parseAsked('email', { value: 'nope' }, 'AU')).toEqual({ problem: 'That isn’t an email address' });
    expect(parseAsked('gender', { value: 'X' }, 'AU')).toEqual({ problem: 'Choose female, male or not saying' });
    expect(parseAsked('preferred_name', { value: 'x'.repeat(101) }, 'AU')).toEqual({ problem: 'Preferred name is too long (100 characters at most)' });
    expect(parseAsked('address', { line1: '1 Sample Road', state: 'vic', postcode: '3000' }, 'AU', 'add'))
      .toMatchObject({ asked: { line1: '1 Sample Road', region: 'VIC', postcode: '3000', country: 'AU' } });
    expect(parseAsked('address', {}, 'AU', 'remove')).toEqual({ asked: null });
  });

  it('says values and changes in plain words, never sending values by email', () => {
    expect(valueLine('gender', { value: 'F' }, 'AU')).toBe('Female');
    expect(valueLine('mobile', { value: null }, 'AU')).toBe('Not given');
    expect(valueLine('name', { firstName: 'Ana', lastName: 'Example' }, 'AU')).toBe('Ana Example');
    expect(changeWhat('address', 'current')).toBe('Make an address current');
    expect(sameValue({ value: 'a' }, { value: 'a' })).toBe(true);
    expect(sameValue({ value: 'a' }, null)).toBe(false);
    const m = toApproveEmail('Ana Example', 'Change mobile', 'Caring Example', null);
    expect(m.body).toContain('Ana Example asked in the app: change mobile.');
    expect(decidedMessage('Ana', 'Change mobile', 'declined', 'Please call us', 'Caring Example').push.body)
      .toBe("Your change (change mobile) wasn't approved. Please call us");
  });
});

describe('detail changes: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let appPool: Pool;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const signIn = async (sub: string, email: string) => {
    idp.addUser({ sub, email, email_verified: true, name: sub });
    tok[sub] = await idp.token(sub, { expiresIn: '1h' });
  };
  const worker = async () => (await owner.query('select first_name, last_name, preferred_name, email, phone, gender from workers where id = $1', [ids.ana])).rows[0];

  beforeAll(async () => {
    process.env.NOTIFY_DISPATCH = 'off';
    db = await createTestDatabase('crop_detail_changes');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('c4u','Caring Example'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'nosy@x.com','owner')`, [ids.c4u, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['nosy', 'nosy@x.com']]) await signIn(sub, email);
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    appPool = createPool(db.appUrl);
    ids.ana = (await http().post('/workers').set(as('admin')).send({
      firstName: 'Ana', lastName: 'Example', preferredName: 'Annie', roles: ['Chef'], email: 'ana@example.com', phone: '0412 345 678', gender: 'F',
    }).expect(201)).body.id;
    await http().post('/workers').set(as('admin')).send({ firstName: 'Bo', lastName: 'Example', email: 'bo@example.com' }).expect(201);
    await http().post(`/workers/${ids.ana}/addresses`).set(as('admin')).send({ line1: '12 Example Street', suburb: 'Richmond', state: 'VIC', postcode: '3121' }).expect(201);
    await http().post(`/workers/${ids.ana}/app-access`).set(as('admin')).expect(201);
    await signIn('ana', 'ana@example.com');
    await http().get('/my').set(as('ana')).expect(200);
  });

  afterAll(async () => {
    await appPool?.end();
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('applies a change at once when the business lets them (CROP’s defaults), and logs it', async () => {
    const r = await http().post('/my/details').set(as('ana')).send({ field: 'mobile', value: '0498 765 432' }).expect(200);
    expect(r.body.outcome).toBe('changed');
    expect((await worker()).phone).toBe('+61498765432');
    expect(r.body.details.fields.find((f: { field: string }) => f.field === 'mobile').value).toBe('+61498765432');
    await http().post('/my/details').set(as('ana')).send({ field: 'mobile', value: '0498765432' }).expect(400);
    const log = await http().get(`/workers/${ids.ana}/audit`).set(as('admin')).expect(200);
    expect(JSON.stringify(log.body)).toMatch(/\+61498765432/);
  });

  it('refuses what the business keeps or only shows', async () => {
    const g = await http().post('/my/details').set(as('ana')).send({ field: 'gender', value: 'M' }).expect(409);
    expect(g.body.message).toBe('The office keeps your gender: ask them if it needs changing');
    const n = await http().post('/my/details').set(as('ana')).send({ field: 'name', firstName: 'Ann', lastName: 'Example' }).expect(409);
    expect(n.body.message).toBe('Ask the office to change your name');
    await http().post('/my/details').set(as('ana')).send({ field: 'birthday', value: 'x' }).expect(400);
  });

  it('adds, corrects, moves and removes their own addresses, keeping history', async () => {
    let d = (await http().post('/my/details').set(as('ana')).send({ field: 'address', action: 'add', line1: '5 Sample Lane', suburb: 'Carlton', state: 'VIC', postcode: '3053' }).expect(200)).body.details;
    expect(d.addresses.list).toHaveLength(2);
    const second = d.addresses.list.find((a: { current: boolean }) => !a.current);
    d = (await http().post('/my/details').set(as('ana')).send({ field: 'address', action: 'current', addressId: second.id }).expect(200)).body.details;
    expect(d.addresses.list[0]).toMatchObject({ id: second.id, current: true });
    d = (await http().post('/my/details').set(as('ana')).send({ field: 'address', action: 'correct', addressId: second.id, line1: '7 Sample Lane' }).expect(200)).body.details;
    expect(d.addresses.list[0]).toMatchObject({ current: true, line: '7 Sample Lane, Carlton VIC 3053' });
    const old = d.addresses.list[1];
    await http().post('/my/details').set(as('ana')).send({ field: 'address', action: 'remove', addressId: old.id }).expect(200);
    const office = await http().get(`/workers/${ids.ana}/addresses`).set(as('admin')).expect(200);
    expect(office.body.earlier.map((a: { ended: string }) => a.ended).sort()).toEqual(['corrected', 'removed']);
    // Someone else's address, or an old version, can't be touched.
    await http().post('/my/details').set(as('ana')).send({ field: 'address', action: 'current', addressId: second.id }).expect(409);
  });

  it('keeps changes for approval when set, tells owners and admins without the values, and lets them withdraw', async () => {
    await http().put('/field-access').set(as('admin')).send({ fields: { mobile: 'approve', name: 'approve' } }).expect(200);
    const r = await http().post('/my/details').set(as('ana')).send({ field: 'mobile', value: '0411 111 111' }).expect(200);
    expect(r.body.outcome).toBe('requested');
    expect((await worker()).phone).toBe('+61498765432');
    expect(r.body.details.changes[0]).toMatchObject({ field: 'mobile', status: 'pending', line: '+61411111111', canWithdraw: true });
    const again = await http().post('/my/details').set(as('ana')).send({ field: 'mobile', value: '0422 222 222' }).expect(409);
    expect(again.body.message).toMatch(/already asked/);
    const mail = (await owner.query(`select to_address, body from notifications where template = 'detail_change_to_approve'`)).rows;
    expect(mail.map(m => m.to_address)).toEqual(['admin@x.com']);
    expect(mail[0].body).not.toMatch(/0411|61411/);
    await http().post(`/my/detail-changes/${r.body.details.changes[0].id}/withdraw`).set(as('ana')).expect(200);
    await http().post(`/my/detail-changes/${r.body.details.changes[0].id}/withdraw`).set(as('ana')).expect(409);
    await http().post('/my/details').set(as('ana')).send({ field: 'mobile', value: '0422 222 222' }).expect(200);
  });

  it('lists them for the office; only owners and admins decide, and approving makes the change', async () => {
    await http().post('/my/details').set(as('ana')).send({ field: 'name', firstName: 'Ana', lastName: 'Sample' }).expect(200);
    const list = await http().get('/detail-changes').set(as('alloc')).expect(200);
    expect(list.body.changes.map((c: { field: string }) => c.field).sort()).toEqual(['mobile', 'name']);
    const mobile = list.body.changes.find((c: { field: string }) => c.field === 'mobile');
    expect(mobile).toMatchObject({ workerName: 'Ana Example', what: 'Change mobile', askedLine: '+61422222222', wasLine: '+61498765432', nowLine: null, canDecide: false });
    await http().post(`/detail-changes/${mobile.id}/approve`).set(as('alloc')).expect(403);
    const ok = await http().post(`/detail-changes/${mobile.id}/approve`).set(as('admin')).send({}).expect(200);
    expect(ok.body).toMatchObject({ status: 'approved', told: 'email' });
    expect((await worker()).phone).toBe('+61422222222');
    await http().post(`/detail-changes/${mobile.id}/decline`).set(as('admin')).expect(409);
    const name = list.body.changes.find((c: { field: string }) => c.field === 'name');
    await http().post(`/detail-changes/${name.id}/decline`).set(as('admin')).send({ note: 'Please bring your new ID to the office' }).expect(200);
    expect((await worker()).last_name).toBe('Example');
    const told = (await owner.query(`select to_address, body from notifications where template = 'detail_change_decided' order by created_at`)).rows;
    expect(told.map(m => m.to_address)).toEqual(['ana@example.com', 'ana@example.com']);
    expect(told[1].body).toContain('Please bring your new ID to the office');
    const mine = await http().get('/my/details').set(as('ana')).expect(200);
    expect(mine.body.changes.map((c: { status: string }) => c.status)).toEqual(['declined', 'approved']);
  });

  it('refuses an email someone else here uses when approving', async () => {
    await http().put('/field-access').set(as('admin')).send({ fields: { email: 'approve' } }).expect(200);
    const r = await http().post('/my/details').set(as('ana')).send({ field: 'email', value: 'bo@example.com' }).expect(200);
    const id = r.body.details.changes.find((c: { field: string }) => c.field === 'email').id;
    const bad = await http().post(`/detail-changes/${id}/approve`).set(as('admin')).expect(409);
    expect(bad.body.message).toBe('Someone else here already uses that email');
    expect((await worker()).email).toBe('ana@example.com');
  });

  it('is audited, never deleted or rewritten by the app, and another business sees nothing', async () => {
    const log = await http().get('/audit?table=detail_change_requests').set(as('admin')).expect(200);
    expect(JSON.stringify(log.body)).toMatch(/Change asked for in the app/);
    await expect(withTenant(appPool, ids.c4u, db => db.query('delete from detail_change_requests'))).rejects.toThrow(/permission denied/);
    await expect(withTenant(appPool, ids.c4u, db => db.query(`update detail_change_requests set asked = '{}'`))).rejects.toThrow(/permission denied/);
    expect((await http().get('/detail-changes?status=all').set(as('nosy')).expect(200)).body.changes).toEqual([]);
    expect((await withTenant(appPool, ids.nosy, db => db.query('select * from detail_change_requests'))).rowCount).toBe(0);
  });
});
