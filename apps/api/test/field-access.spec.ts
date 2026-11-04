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
import { FIELD_DEFAULTS, FIELD_RULES, PERSON_FIELDS, accessList, accessOf, parseAccess, personCan } from '../src/workforce/field-access.js';
import { startFakeIdp } from './fake-idp.js';

describe('field access: rules (David, 3 Nov, answer 5)', () => {
  it('starts self-service first, with name and email seen and gender kept by the office', () => {
    expect(FIELD_DEFAULTS).toEqual({ name: 'see', preferred_name: 'change', email: 'see', mobile: 'change', addresses: 'change', gender: 'hidden' });
    for (const f of PERSON_FIELDS) expect(FIELD_RULES[f].allowed).toContain(FIELD_RULES[f].fallback);
  });

  it('fills the gaps with the defaults and ignores anything stored that is no longer allowed', () => {
    expect(accessOf([{ field: 'mobile', person: 'approve' }, { field: 'email', person: 'change' }, { field: 'dob', person: 'see' }]))
      .toEqual({ ...FIELD_DEFAULTS, mobile: 'approve' });
  });

  it('reads a change and refuses levels a field can’t have, with the reason', () => {
    expect(parseAccess({ fields: { mobile: 'approve', gender: 'see' } })).toEqual({ changes: { mobile: 'approve', gender: 'see' } });
    expect(parseAccess({ fields: { name: 'hidden' } })).toMatchObject({ problem: expect.stringMatching(/^Name can’t be “office only”: The app always greets them/) });
    expect(parseAccess({ fields: { email: 'change' } })).toMatchObject({ problem: expect.stringMatching(/always needs approval/) });
    expect(parseAccess({ fields: { dateOfBirth: 'see' } })).toEqual({ problem: 'There is no field called “dateOfBirth”' });
    expect(parseAccess({ fields: { mobile: 'maybe' } })).toEqual({ problem: 'Choose who can see and change mobile' });
    expect(parseAccess({})).toEqual({ problem: 'Say who can see and change each field' });
  });

  it('lists every field and says what the app can do', () => {
    const list = accessList({ ...FIELD_DEFAULTS, mobile: 'approve' });
    expect(list.map(r => r.field)).toEqual([...PERSON_FIELDS]);
    expect(list.find(r => r.field === 'mobile')).toMatchObject({ person: 'approve', isDefault: false, defaultPerson: 'change' });
    expect(personCan('hidden')).toEqual({ see: false, change: false, needsApproval: false });
    expect(personCan('see')).toEqual({ see: true, change: false, needsApproval: false });
    expect(personCan('approve')).toEqual({ see: true, change: true, needsApproval: true });
    expect(personCan('change')).toEqual({ see: true, change: true, needsApproval: false });
  });
});

describe('field access: API', () => {
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

  beforeAll(async () => {
    db = await createTestDatabase('crop_field_access');
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
      firstName: 'Ana', lastName: 'Example', preferredName: 'Annie', roles: ['Chef'], email: 'ana@example.com', phone: '0412 345 678', gender: 'F', dateOfBirth: '1990-05-01',
    }).expect(201)).body.id;
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

  it('lists CROP’s defaults to any office person', async () => {
    const r = await http().get('/field-access').set(as('alloc')).expect(200);
    expect(r.body.fields.map((f: { field: string; person: string }) => [f.field, f.person])).toEqual(Object.entries(FIELD_DEFAULTS));
    expect(r.body.words.approve).toBe('They can change it; the office approves');
  });

  it('shows the person only what they may see, never the date of birth', async () => {
    const r = await http().get('/my/details').set(as('ana')).expect(200);
    expect(r.body.fields).toEqual([
      { field: 'name', label: 'Name', value: 'Ana Example', raw: { firstName: 'Ana', lastName: 'Example' }, canChange: false, needsApproval: false },
      { field: 'preferred_name', label: 'Preferred name', value: 'Annie', raw: 'Annie', canChange: true, needsApproval: false },
      { field: 'email', label: 'Email', value: 'ana@example.com', raw: 'ana@example.com', canChange: false, needsApproval: false },
      { field: 'mobile', label: 'Mobile', value: '+61412345678', raw: '+61412345678', canChange: true, needsApproval: false },
    ]);
    expect(r.body.addresses).toMatchObject({ canChange: true, needsApproval: false, list: [{ line: '12 Example Street, Richmond VIC 3121', current: true }] });
    expect(JSON.stringify(r.body)).not.toMatch(/1990|dateOfBirth/);
  });

  it('lets owners and admins change them (allocators can’t), refusing levels a field can’t have', async () => {
    await http().put('/field-access').set(as('alloc')).send({ fields: { gender: 'see' } }).expect(403);
    const bad = await http().put('/field-access').set(as('admin')).send({ fields: { email: 'change' } }).expect(400);
    expect(bad.body.message).toMatch(/always needs approval/);
    const r = await http().put('/field-access').set(as('admin')).send({ fields: { gender: 'see', mobile: 'approve', addresses: 'hidden', name: 'see' } }).expect(200);
    expect(r.body.fields.find((f: { field: string }) => f.field === 'mobile')).toMatchObject({ person: 'approve', isDefault: false });
    // Choosing the default for a field with no row stores nothing.
    expect((await owner.query(`select field from field_access where tenant_id = $1 order by field`, [ids.c4u])).rows.map(r => r.field)).toEqual(['addresses', 'gender', 'mobile']);
    const mine = await http().get('/my/details').set(as('ana')).expect(200);
    expect(mine.body.fields.find((f: { field: string }) => f.field === 'mobile')).toMatchObject({ canChange: true, needsApproval: true });
    expect(mine.body.fields.find((f: { field: string }) => f.field === 'gender')).toMatchObject({ value: 'Female', canChange: false });
    expect(mine.body.addresses).toBeNull();
    // Going back to a default updates the stored row.
    await http().put('/field-access').set(as('admin')).send({ fields: { addresses: 'change' } }).expect(200);
    expect((await http().get('/my/details').set(as('ana')).expect(200)).body.addresses).not.toBeNull();
  });

  it('is in the audit log, and another business sees nothing of it', async () => {
    const log = await http().get('/audit?table=field_access').set(as('admin')).expect(200);
    expect(JSON.stringify(log.body)).toMatch(/Who sees and changes a detail/);
    const other = await http().get('/field-access').set(as('nosy')).expect(200);
    expect(other.body.fields.every((f: { isDefault: boolean }) => f.isDefault)).toBe(true);
    const seen = await withTenant(appPool, ids.nosy, db => db.query('select * from field_access'));
    expect(seen.rowCount).toBe(0);
  });

  it('can’t be deleted by the app', async () => {
    await expect(withTenant(appPool, ids.c4u, db => db.query('delete from field_access'))).rejects.toThrow(/permission denied/);
  });

  it('needs a linked person for /my/details', async () => {
    await http().get('/my/details').set(as('alloc')).expect(404);
  });
});
