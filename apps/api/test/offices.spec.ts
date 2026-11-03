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
import { inOffice, officeChips, officeParam, parseOfficeFilter, peopleProblem } from '../src/facilities/offices.js';
import { startFakeIdp } from './fake-idp.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('offices: rules (David, 3 Nov)', () => {
  it('reads the office filter, defaulting to the person’s own offices', () => {
    expect(parseOfficeFilter(undefined, true)).toEqual({ kind: 'mine' });
    expect(parseOfficeFilter(undefined, false)).toEqual({ kind: 'all' });
    expect(parseOfficeFilter('mine', false)).toEqual({ kind: 'all' });
    expect(parseOfficeFilter('all', true)).toEqual({ kind: 'all' });
    expect(parseOfficeFilter('none', true)).toEqual({ kind: 'none' });
    expect(parseOfficeFilter(A, false)).toEqual({ kind: 'one', id: A });
    expect(parseOfficeFilter('nonsense', true)).toEqual({ kind: 'all' });
    expect(officeParam({ kind: 'all' })).toBeNull();
    expect(officeParam({ kind: 'one', id: A })).toBe(A);
    const mine = new Set([A]);
    expect(inOffice({ kind: 'mine' }, A, mine)).toBe(true);
    expect(inOffice({ kind: 'mine' }, B, mine)).toBe(false);
    expect(inOffice({ kind: 'mine' }, null, mine)).toBe(false);
    expect(inOffice({ kind: 'none' }, null, mine)).toBe(true);
    expect(inOffice({ kind: 'one', id: B }, B, mine)).toBe(true);
  });

  it('puts the person’s offices first and leaves out switched-off ones with nothing in them', () => {
    const chips = officeChips(
      [{ id: A, name: 'VIC Melbourne Metro', active: true }, { id: B, name: 'QLD Sunshine Coast', active: true }, { id: 'c', name: 'Old', active: false }],
      [{ officeId: A }, { officeId: B }, { officeId: B }, { officeId: null }], new Set([A]));
    expect(chips).toEqual({
      offices: [{ id: A, name: 'VIC Melbourne Metro', count: 1, mine: true }, { id: B, name: 'QLD Sunshine Coast', count: 2, mine: false }],
      noOffice: 1,
    });
  });

  it('only lets office people belong to an office', () => {
    expect(peopleProblem([A], new Set([A]))).toBeNull();
    expect(peopleProblem([B], new Set([A]))).toMatch(/Only owners/);
    expect(peopleProblem(['x'], new Set([A]))).toMatch(/Choose/);
  });
});

describe('offices: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  type Queue = { office: string | null; myOffices: string[]; offices: { id: string; name: string; count: number; mine: boolean }[]; noOffice: number;
    counts: Record<string, number>; shifts: { id: string; officeId: string | null; officeName: string | null }[] };
  const queue = async (q = '', who = 'alloc') => (await http().get(`/allocations/queue${q}`).set(as(who)).expect(200)).body as Queue;

  beforeAll(async () => {
    db = await createTestDatabase('crop_offices');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('c4u','Caring Example'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'nosy@x.com','owner')`, [ids.c4u, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: sub === 'alloc' ? 'Alex Allocator' : undefined });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    // Everyone signs in once so their accounts exist.
    for (const who of ['admin', 'alloc', 'worker', 'nosy']) await http().get('/me').set(as(who)).expect(200);
    ids.client = (await http().post('/clients').set(as('admin')).send({ name: 'Bayside Health' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('adds, renames and switches off offices (owners and admins only)', async () => {
    const metro = (await http().post('/offices').set(as('admin')).send({ name: 'VIC Melbourne Metro', state: 'vic' }).expect(201)).body;
    expect(metro).toMatchObject({ name: 'VIC Melbourne Metro', state: 'VIC', active: true });
    ids.metro = metro.id;
    ids.coast = (await http().post('/offices').set(as('admin')).send({ name: 'QLD Sunshine Coast', state: 'QLD' }).expect(201)).body.id;
    await http().post('/offices').set(as('admin')).send({ name: ' vic melbourne metro ' }).expect(400);
    await http().post('/offices').set(as('admin')).send({ name: 'Nowhere', state: 'XX' }).expect(400);
    await http().post('/offices').set(as('alloc')).send({ name: 'Mine' }).expect(403);
    ids.old = (await http().post('/offices').set(as('admin')).send({ name: 'Geelong' }).expect(201)).body.id;
    expect((await http().patch(`/offices/${ids.old}`).set(as('admin')).send({ active: false, state: null }).expect(200)).body).toMatchObject({ active: false, state: null });
    // A switched-off name can be used again.
    await http().post('/offices').set(as('admin')).send({ name: 'Geelong' }).expect(201);
    await http().patch(`/offices/${ids.coast}`).set(as('alloc')).send({ name: 'x' }).expect(403);
    await http().patch('/offices/00000000-0000-4000-8000-000000000000').set(as('admin')).send({ name: 'x' }).expect(404);
    const list = (await http().get('/offices').set(as('alloc')).expect(200)).body as { name: string; active: boolean }[];
    expect(list.map(o => o.name)).toEqual(['Geelong', 'QLD Sunshine Coast', 'VIC Melbourne Metro', 'Geelong']);
    await http().get('/offices').set(as('worker')).expect(403);
  });

  it('puts sites in an office', async () => {
    const site = (await http().post('/facilities').set(as('admin')).send({ name: 'Bayside Campus', state: 'VIC', clientId: ids.client, officeId: ids.metro }).expect(201)).body;
    expect(site).toMatchObject({ officeId: ids.metro, officeName: 'VIC Melbourne Metro' });
    ids.bay = site.id;
    ids.coastSite = (await http().post('/facilities').set(as('admin')).send({ name: 'Noosa House', state: 'QLD', clientId: ids.client, officeId: ids.coast }).expect(201)).body.id;
    ids.loose = (await http().post('/facilities').set(as('admin')).send({ name: 'Loose Site', state: 'NSW', clientId: ids.client }).expect(201)).body.id;
    await http().post('/facilities').set(as('admin')).send({ name: 'Bad', officeId: ids.old }).expect(400); // switched off
    expect((await http().patch(`/facilities/${ids.loose}`).set(as('admin')).send({ officeId: ids.coast }).expect(200)).body.officeName).toBe('QLD Sunshine Coast');
    expect((await http().patch(`/facilities/${ids.loose}`).set(as('admin')).send({ officeId: null }).expect(200)).body.officeId).toBeNull();
    // Leaving officeId out keeps it.
    expect((await http().patch(`/facilities/${ids.bay}`).set(as('admin')).send({ name: 'Bayside Campus' }).expect(200)).body.officeId).toBe(ids.metro);
    const metro = ((await http().get('/offices').set(as('alloc')).expect(200)).body as { id: string; siteCount: number; sites: { name: string }[] }[])
      .find(o => o.id === ids.metro)!;
    expect(metro).toMatchObject({ siteCount: 1, sites: [{ name: 'Bayside Campus' }] });
  });

  it('attaches office people, never workers', async () => {
    const team = (await http().get('/team').set(as('admin')).expect(403));
    expect(team.status).toBe(403); // the team list itself stays the owner's
    const alloc = (await owner.query<{ id: string }>(`select id from users where email = 'alloc@x.com'`)).rows[0].id;
    const worker = (await owner.query<{ id: string }>(`select id from users where email = 'w@x.com'`)).rows[0].id;
    ids.allocUser = alloc;
    const people = (await http().get('/offices/people').set(as('admin')).expect(200)).body as { userId: string; role: string }[];
    expect(people.map(p => p.role).sort()).toEqual(['admin', 'allocator']);
    await http().get('/offices/people').set(as('alloc')).expect(403);
    await http().put(`/offices/${ids.metro}/people`).set(as('admin')).send({ userIds: [worker] }).expect(400);
    const r = (await http().put(`/offices/${ids.metro}/people`).set(as('admin')).send({ userIds: [alloc, alloc] }).expect(200)).body;
    expect(r.people).toEqual([{ userId: alloc, name: expect.any(String) }]);
    await http().put(`/offices/${ids.metro}/people`).set(as('alloc')).send({ userIds: [] }).expect(403);
    const list = (await http().get('/offices').set(as('alloc')).expect(200)).body as { id: string; mine: boolean; people: unknown[] }[];
    expect(list.find(o => o.id === ids.metro)).toMatchObject({ mine: true, people: [{ userId: alloc }] });
    expect(list.find(o => o.id === ids.coast)).toMatchObject({ mine: false, people: [] });
  });

  it('filters the allocation queue by office, the person’s own first', async () => {
    const mk = async (facilityId: string) => (await http().post('/client-orders').set(as('alloc')).send({
      clientId: ids.client, facilityId, role: 'Nurse', date: ahead(2), startTime: '07:00', endTime: '15:00', quantity: 1, channel: 'phone', requestedByName: 'Pat Ward',
    }).expect(201)).body.ids[0] as string;
    ids.s1 = await mk(ids.bay);
    ids.s2 = await mk(ids.coastSite);
    ids.s3 = await mk(ids.loose);
    // The allocator works in Metro: their queue starts there.
    const mine = await queue();
    expect(mine.office).toBe('mine');
    expect(mine.myOffices).toEqual([ids.metro]);
    expect(mine.shifts.map(s => s.id)).toEqual([ids.s1]);
    expect(mine.shifts[0]).toMatchObject({ officeId: ids.metro, officeName: 'VIC Melbourne Metro' });
    expect(mine.counts.all).toBe(1);
    expect(mine.offices.map(o => [o.name, o.count, o.mine])).toEqual([['VIC Melbourne Metro', 1, true], ['Geelong', 0, false], ['QLD Sunshine Coast', 1, false]]);
    expect(mine.noOffice).toBe(1);
    expect((await queue('?office=all')).counts.all).toBe(3);
    expect((await queue('?office=none')).shifts.map(s => s.id)).toEqual([ids.s3]);
    expect((await queue(`?office=${ids.coast}`)).shifts.map(s => s.id)).toEqual([ids.s2]);
    // The admin has no offices: everything; the region filter still works on top.
    const all = await queue('', 'admin');
    expect(all.office).toBeNull();
    expect(all.counts.all).toBe(3);
    expect((await queue('?region=QLD', 'admin')).shifts.map(s => s.id)).toEqual([ids.s2]);
  });

  it('keeps offices to their own business', async () => {
    expect((await http().get('/offices').set(as('nosy')).expect(200)).body).toEqual([]);
    await http().patch(`/offices/${ids.metro}`).set(as('nosy')).send({ name: 'Taken' }).expect(404);
    await http().put(`/offices/${ids.metro}/people`).set(as('nosy')).send({ userIds: [] }).expect(404);
    const nosySite = (await http().post('/facilities').set(as('nosy')).send({ name: 'Their site', officeId: ids.metro }).expect(400));
    expect(nosySite.body.message).toMatch(/office/);
    expect((await queue('', 'nosy')).offices).toEqual([]);
    // Straight in the database as the app: RLS hides the rows and refuses writing into another business.
    const pool = new Pool({ connectionString: db.appUrl });
    try {
      const seen = await withTenant(pool, ids.nosy, async c => (await c.query('select count(*)::int as n from offices')).rows[0].n + (await c.query('select count(*)::int as n from member_offices')).rows[0].n);
      expect(seen).toBe(0);
      await expect(withTenant(pool, ids.nosy, c => c.query(`insert into offices(tenant_id, name) values ($1, 'Sneaky')`, [ids.c4u]))).rejects.toThrow(/row-level security/);
      await expect(withTenant(pool, ids.c4u, c => c.query('delete from offices'))).rejects.toThrow(/permission denied/);
    } finally {
      await pool.end();
    }
    // Every change is in the audit log.
    const audited = (await owner.query<{ table_name: string; n: number }>(
      `select table_name, count(*)::int as n from audit_log where table_name in ('offices', 'member_offices') group by table_name order by table_name`)).rows;
    expect(audited.map(r => r.table_name)).toEqual(['member_offices', 'offices']);
  });
});
