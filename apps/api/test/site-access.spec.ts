import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { acrossSites, auditStore, withTenant } from '@crop/db';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { accessProblem, siteChanges, sitesFor, sitesWords } from '../src/facilities/site-access.js';
import { supervisorCard, supervisorEligibility, supervisorShift, supervisorWorker } from '../src/workforce/supervisor-view.js';
import { startFakeIdp } from './fake-idp.js';

describe('site access: rules (David, 4 Nov)', () => {
  it('limits supervisors always and allocators only when sites are chosen', () => {
    expect(sitesFor('owner', ['a'])).toBeNull();
    expect(sitesFor('admin', [])).toBeNull();
    expect(sitesFor('allocator', [])).toBeNull();
    expect(sitesFor('allocator', ['a'])).toEqual(['a']);
    expect(sitesFor('supervisor', [])).toEqual([]);
    expect(sitesWords('supervisor', [])).toBe('No {sites} yet');
    expect(sitesWords('allocator', [])).toBe('Every {site}');
    expect(sitesWords('allocator', ['Smith St', 'Bridge Rd'])).toBe('Bridge Rd and Smith St');
    expect(sitesWords('supervisor', ['D', 'C', 'B', 'A'])).toBe('A, B and 2 more');
    expect(siteChanges(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
  });

  it('refuses sites for owners and admins, and other role changes', () => {
    const known = new Set(['a']);
    expect(accessProblem({ currentRole: 'admin', newRole: null, facilityIds: ['a'], known })).toBe('Owners and admins always see every {site}');
    expect(accessProblem({ currentRole: 'admin', newRole: null, facilityIds: [], known })).toBeNull();
    expect(accessProblem({ currentRole: 'admin', newRole: 'supervisor', facilityIds: [], known })).toBe('Owners and admins are changed on the Platform screen');
    expect(accessProblem({ currentRole: 'allocator', newRole: 'admin', facilityIds: [], known })).toBe('Choose allocator or supervisor');
    expect(accessProblem({ currentRole: 'allocator', newRole: 'supervisor', facilityIds: ['zz'], known })).toBe('Choose {sites} of this business');
    expect(accessProblem({ currentRole: 'allocator', newRole: 'supervisor', facilityIds: ['a'], known })).toBeNull();
  });

  it('gives supervisors the shift-related facts only', () => {
    const w = supervisorWorker({
      id: '1', firstName: 'Ana', lastName: 'Example', email: 'ana@example.com', phone: '+61400000000', notes: 'n', gender: 'F',
      dateOfBirth: '2000-01-01', roles: ['Carer'], card: { held: ['First aid'], nextExpiry: { name: 'Visa', date: '2027-01-01' }, under18: false, weekHours: 8 },
      credentials: [{ id: 'c', typeName: 'First aid', number: '123', notes: 'x', verificationNote: 'y', expiryDate: '2027-01-01', verification: 'verified', documents: [{ id: 'd' }] }],
      issues: [{ credentialTypeId: 'right-to-work', typeName: 'Right to work', problem: 'no_work_rights', severity: 'hard', credentialId: 'r' }],
    });
    expect(Object.keys(w).sort()).toEqual(['card', 'credentials', 'firstName', 'id', 'issues', 'lastName', 'limitedView', 'roles']);
    expect(w.card).toEqual({ held: ['First aid'], nextExpiry: null, weekHours: 8 });
    expect(w.credentials).toEqual([{ id: 'c', typeName: 'First aid', expiryDate: '2027-01-01', verification: 'verified', documents: [] }]);
    expect(w.issues).toEqual([{ credentialTypeId: 'right-to-work', typeName: 'Right to work', problem: 'missing', severity: 'hard', credentialId: null }]);
    expect(supervisorCard({ nextExpiry: { name: 'First aid', date: 'x' } })).toEqual({ nextExpiry: { name: 'First aid', date: 'x' } });
    const e = supervisorEligibility({
      eligible: false,
      blocks: [{ code: 'right_to_work', message: "Ana's Right to work doesn't have confirmed work rights (VEVO)" }, { code: 'visa_hours', message: "Ana's visa allows 48 hours" }],
      warnings: [{ code: 'rest', message: 'Short rest' }],
    }, 'Ana');
    expect(e.blocks.map(b => b.message)).toEqual(["Ana's right to work isn't met for this {shift}", "Ana can't work more hours in this fortnight"]);
    expect(e.warnings[0].message).toBe('Short rest');
    expect(supervisorShift({ genderRequested: null, workerGender: 'F' }).workerGender).toBeNull();
    // Vaccinations are health information: only "Vaccination record" (like messages).
    const health = { ids: new Set(['flu']), names: new Set(['Influenza vaccination']) };
    const v = supervisorWorker({
      id: '2', firstName: 'Ben', lastName: 'Example', roles: [], card: { held: ['Influenza vaccination', 'First aid'], nextExpiry: { name: 'Influenza vaccination', date: '2027-01-01' } },
      credentials: [{ id: 'v', credentialTypeId: 'flu', typeName: 'Influenza vaccination', issuedBy: 'Clinic', verification: 'verified' }],
      issues: [{ credentialTypeId: 'flu', typeName: 'Influenza vaccination', problem: 'expired', severity: 'hard' }],
    }, health);
    expect(v.card).toEqual({ held: ['Vaccination record', 'First aid'], nextExpiry: { name: 'Vaccination record', date: '2027-01-01' } });
    expect(v.credentials).toEqual([{ id: 'v', credentialTypeId: 'flu', typeName: 'Vaccination record', category: 'vaccination', issuedBy: null, verification: 'verified', documents: [] }]);
    expect((v.issues as { typeName: string }[])[0].typeName).toBe('Vaccination record');
    expect(supervisorEligibility({ eligible: false, blocks: [{ code: 'credential', message: "Ben's Influenza vaccination is missing" }], warnings: [] }, 'Ben', health).blocks[0].message)
      .toBe("Ben's vaccination record is missing");
    expect(supervisorShift({ genderRequested: 'F', workerGender: 'F' }).workerGender).toBe('F');
  });
});

describe('site access: API and database (migration 0086)', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let pool: Pool;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const mkShift = async (facilityId: string, date: string, start = '07:00', end = '15:00') =>
    (await http().post('/shifts').set(as('admin')).send({ facilityId, role: 'Carer', date, startTime: start, endTime: end }).expect(201)).body.ids[0] as string;
  const userId = async (email: string) => (await owner.query<{ id: string }>('select id from users where email = $1', [email])).rows[0].id;

  beforeAll(async () => {
    db = await createTestDatabase('crop_site_access');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    pool = new Pool({ connectionString: db.appUrl });
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('acme','Example Care'),('nosy','Nosy Co') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(
      `insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'lim@x.com','allocator'),($1,'free@x.com','allocator'),
         ($1,'sup@x.com','supervisor'),($1,'empty@x.com','supervisor'),($1,'w@x.com','worker'),($2,'nosy@x.com','owner')`, [ids.acme, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['lim', 'lim@x.com'], ['free', 'free@x.com'], ['sup', 'sup@x.com'], ['empty', 'empty@x.com'], ['worker', 'w@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: sub });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    for (const who of Object.keys(tok)) await http().get('/me').set(as(who)).expect(200);
    for (const [k, first] of [['ana', 'Ana'], ['ben', 'Ben']]) {
      ids[k] = (await http().post('/workers').set(as('admin')).send({ firstName: first, lastName: 'Example', roles: ['Carer'], email: `${k}@example.com`, phone: '0412 345 678', notes: 'Private note' }).expect(201)).body.id;
      await http().put(`/workers/${ids[k]}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${ids[k]}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    }
    await http().post(`/workers/${ids.ana}/addresses`).set(as('admin')).send({ label: 'Home', line1: '12 Example Street', suburb: 'Richmond', state: 'VIC', postcode: '3121' }).expect(201);
    ids.A = (await http().post('/facilities').set(as('admin')).send({ name: 'Alpha House', state: 'VIC', postcode: '3000' }).expect(201)).body.id;
    ids.B = (await http().post('/facilities').set(as('admin')).send({ name: 'Bravo House', state: 'VIC' }).expect(201)).body.id;
    ids.limUser = await userId('lim@x.com');
    ids.supUser = await userId('sup@x.com');
    ids.freeUser = await userId('free@x.com');
    ids.adminUser = await userId('admin@x.com');
  });

  afterAll(async () => {
    await pool?.end();
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lets owners and admins choose sites and switch allocators and supervisors', async () => {
    const before = (await http().get('/site-access').set(as('admin')).expect(200)).body;
    expect(before.people.map((p: { name: string; role: string; sitesWords: string }) => `${p.name}:${p.role}:${p.sitesWords}`))
      .toEqual(['admin:admin:Every site', 'free:allocator:Every site', 'lim:allocator:Every site', 'empty:supervisor:No sites yet', 'sup:supervisor:No sites yet']);
    await http().get('/site-access').set(as('lim')).expect(403);
    expect((await http().put(`/site-access/${ids.limUser}`).set(as('admin')).send({ facilityIds: [ids.A] }).expect(200)).body)
      .toMatchObject({ role: 'allocator', limited: true, sitesWords: 'Alpha House' });
    await http().put(`/site-access/${ids.supUser}`).set(as('admin')).send({ facilityIds: [ids.A] }).expect(200);
    await http().put(`/site-access/${ids.adminUser}`).set(as('admin')).send({ facilityIds: [ids.A] }).expect(400);
    await http().put(`/site-access/${ids.limUser}`).set(as('admin')).send({ facilityIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
    // Switching roles: free becomes a supervisor (nothing chosen = sees nothing), then back.
    expect((await http().put(`/site-access/${ids.freeUser}`).set(as('admin')).send({ role: 'supervisor', facilityIds: [] }).expect(200)).body)
      .toMatchObject({ role: 'supervisor', limited: true });
    expect((await http().get('/me').set(as('free')).expect(200)).body.memberships[0]).toMatchObject({ role: 'supervisor', sites: [] });
    await http().put(`/site-access/${ids.freeUser}`).set(as('admin')).send({ role: 'allocator', facilityIds: [] }).expect(200);
    expect((await http().get('/me').set(as('free')).expect(200)).body.memberships[0]).toMatchObject({ role: 'allocator', sites: null });
    expect((await http().get('/me').set(as('lim')).expect(200)).body.memberships[0]).toMatchObject({ role: 'allocator', sites: [ids.A] });
    const audit = (await owner.query(`select count(*)::int as n from audit_log where table_name = 'member_sites'`)).rows[0].n;
    expect(audit).toBeGreaterThan(0);
  });

  it('keeps a limited allocator to their sites, but clashes elsewhere still block', async () => {
    const a1 = await mkShift(ids.A, ahead(3));
    const a2 = await mkShift(ids.A, ahead(4), '08:00', '12:00');
    const b1 = await mkShift(ids.B, ahead(4), '09:00', '17:00');
    Object.assign(ids, { a1, a2, b1 });
    await http().post(`/shifts/${b1}/assign`).set(as('admin')).send({ workerId: ids.ben }).expect(200);

    const facilities = (await http().get('/facilities').set(as('lim')).expect(200)).body as { name: string }[];
    expect(facilities.map(f => f.name)).toEqual(['Alpha House']);
    const roster = (await http().get(`/roster?from=${ahead(0)}&to=${ahead(10)}`).set(as('lim')).expect(200)).body;
    expect(roster.shifts.map((s: { id: string }) => s.id).sort()).toEqual([a1, a2].sort());
    // Hours rostered still count every site (Ben's 8 hours at Bravo).
    expect(roster.people.find((p: { id: string }) => p.id === ids.ben).rosteredHours).toBe(8);
    await http().get(`/shifts/${b1}`).set(as('lim')).expect(404);
    await http().post(`/shifts/${b1}/unassign`).set(as('lim')).send({}).expect(404);
    const refused = await http().post('/shifts').set(as('lim')).send({ facilityId: ids.B, role: 'Carer', date: ahead(5), startTime: '07:00', endTime: '15:00' });
    expect([403, 400, 404]).toContain(refused.status);
    expect((await owner.query('select count(*)::int as n from shifts where facility_id = $1', [ids.B])).rows[0].n).toBe(1);
    // Ben is at Bravo then: double booking is seen across sites.
    const clash = await http().post(`/shifts/${a2}/assign`).set(as('lim')).send({ workerId: ids.ben }).expect(409);
    expect(clash.body.message).toMatch(/Ben Example/);
    await http().post(`/shifts/${a1}/assign`).set(as('lim')).send({ workerId: ids.ana }).expect(200);
    // Their people: Ana (on a shift at Alpha), not Ben.
    const people = (await http().get('/workers').set(as('lim')).expect(200)).body as { firstName: string; email?: string }[];
    expect(people.map(p => p.firstName)).toEqual(['Ana']);
    expect(people[0].email).toBe('ana@example.com'); // allocators keep the full record
    // Unlimited office people still see everything.
    expect(((await http().get(`/roster?from=${ahead(0)}&to=${ahead(10)}`).set(as('free')).expect(200)).body.shifts as unknown[]).length).toBe(3);
    expect(((await http().get('/workers').set(as('free')).expect(200)).body as unknown[]).length).toBe(2);
  });

  it('lets a supervisor roster at their sites without personal details', async () => {
    const people = (await http().get('/workers').set(as('sup')).expect(200)).body as Record<string, unknown>[];
    expect(people.map(p => p.firstName)).toEqual(['Ana']);
    for (const k of ['email', 'phone', 'notes', 'dateOfBirth', 'gender']) expect(people[0]).not.toHaveProperty(k);
    const ana = (await http().get(`/workers/${ids.ana}`).set(as('sup')).expect(200)).body;
    expect(ana).toMatchObject({ firstName: 'Ana', limitedView: true });
    expect(ana).not.toHaveProperty('email');
    // Searching by email or phone finds nobody for a supervisor.
    expect(((await http().get('/workers?search=ana@example').set(as('sup')).expect(200)).body as unknown[]).length).toBe(0);
    await http().get(`/workers/${ids.ana}/addresses`).set(as('sup')).expect(403);
    await http().get(`/workers/${ids.ana}/right-to-work`).set(as('sup')).expect(403);
    await http().get(`/workers/${ids.ana}/employment`).set(as('sup')).expect(403);
    await http().get('/audit').set(as('sup')).expect(403);
    await http().get('/settings/x').set(as('sup')).expect(404);

    // The roster at their site: confirm, take off, offer, put on.
    await http().get(`/shifts/${ids.b1}`).set(as('sup')).expect(404);
    await http().post(`/shifts/${ids.a1}/confirm`).set(as('sup')).send({}).expect(200);
    await http().post(`/shifts/${ids.a1}/unassign`).set(as('sup')).send({ pulledOut: true }).expect(200);
    const cands = (await http().get(`/shifts/${ids.a1}/candidates`).set(as('sup')).expect(200)).body.candidates as { name: string }[];
    expect(cands.map(c => c.name).sort()).toEqual(['Ana Example', 'Ben Example']);
    // Distance from home (David, 4 Nov): a supervisor sees how far, never the address or postcode.
    const near = cands as unknown as { name: string; distanceKm: number | null }[];
    const anaKm = near.find(c => c.name === 'Ana Example')!.distanceKm;
    expect(anaKm).toBeGreaterThan(1);
    expect(anaKm).toBeLessThan(10);
    expect(near.find(c => c.name === 'Ben Example')!.distanceKm).toBeNull(); // no address on file
    const fill = (await http().get(`/shifts/${ids.a1}/bank-fill?everyone=true`).set(as('sup')).expect(200)).body;
    expect(fill.candidates.find((c: { name: string }) => c.name === 'Ana Example').distanceKm).toBe(anaKm);
    const dist = (await http().post(`/facilities/${ids.A}/distances`).set(as('sup')).send({ workerIds: [ids.ana, ids.ben, 'nope'] }).expect(200)).body;
    expect(dist).toEqual({ distances: { [ids.ana]: anaKm, [ids.ben]: null } });
    for (const body of [cands, fill, dist]) expect(JSON.stringify(body)).not.toMatch(/Richmond|3121|Example Street/);
    // Distance in ranking (David, 4 Nov): beyond the business's free range (25 km by default) people go after the others
    // in their group; within it, or unknown, it makes no difference. Ana lives ~5 km away, Ben's distance is unknown.
    expect((await http().get('/settings').set(as('admin')).expect(200)).body.distanceFreeKm).toBe(25);
    await http().patch('/settings').set(as('sup')).send({ distanceFreeKm: 1 }).expect(403);
    await http().patch('/settings').set(as('admin')).send({ distanceFreeKm: 1001 }).expect(400);
    type Ranked = { name: string; eligible: boolean; available?: boolean; warnings: unknown[] };
    const grp = (x: Ranked) => (!x.eligible ? 3 : x.available === false ? 2 : x.warnings.length ? 1 : 0);
    const order = async () => (await http().get(`/shifts/${ids.a1}/candidates`).set(as('sup')).expect(200)).body.candidates as Ranked[];
    expect((await http().patch('/settings').set(as('admin')).send({ distanceFreeKm: 1 }).expect(200)).body.distanceFreeKm).toBe(1);
    const far = await order();
    const [fa, fb] = [far.find(x => x.name === 'Ana Example')!, far.find(x => x.name === 'Ben Example')!];
    expect(grp(fa)).toBe(grp(fb));
    expect(far.indexOf(fa)).toBeGreaterThan(far.indexOf(fb));
    expect(cands.map(x => x.name)).toEqual(['Ana Example', 'Ben Example']); // Ana first as usual
    const fillFar = (await http().get(`/shifts/${ids.a1}/bank-fill?everyone=true`).set(as('sup')).expect(200)).body.candidates as Ranked[];
    expect(fillFar.map(x => x.name)).toEqual(far.map(x => x.name));
    await http().patch('/settings').set(as('admin')).send({ distanceFreeKm: 0 }).expect(200);
    expect((await order()).map(x => x.name)).toEqual(cands.map(x => x.name)); // off = the usual order
    await http().patch('/settings').set(as('admin')).send({ distanceFreeKm: 25 }).expect(200);
    expect((await order()).map(x => x.name)).toEqual(cands.map(x => x.name)); // within range = the usual order
    // Not their site: nothing; another business: nothing.
    await http().post(`/facilities/${ids.B}/distances`).set(as('sup')).send({ workerIds: [ids.ana] }).expect(404);
    await http().post(`/facilities/${ids.A}/distances`).set(as('nosy')).send({ workerIds: [ids.ana] }).expect(404);
    const nosySite = (await http().post('/facilities').set(as('nosy')).send({ name: 'Nosy Place', state: 'VIC', postcode: '3000' }).expect(201)).body.id;
    expect((await http().post(`/facilities/${nosySite}/distances`).set(as('nosy')).send({ workerIds: [ids.ana] }).expect(200)).body).toEqual({ distances: { [ids.ana]: null } });
    await http().post(`/shifts/${ids.a1}/assign`).set(as('sup')).send({ workerId: ids.ana }).expect(200);
    // Offering queues messages (the message log is written, though supervisors can't read it).
    const offered = await http().post(`/shifts/${ids.a2}/offers`).set(as('sup')).send({ workerIds: [ids.ana] });
    expect(offered.status, JSON.stringify(offered.body)).toBeLessThan(300);
    expect((await owner.query(`select count(*)::int as n from notifications where tenant_id = $1 and template = 'shift_offer'`, [ids.acme])).rows[0].n).toBeGreaterThan(0);
    // The offer tells Ana how far it is from her home (David, 4 Nov), never where she lives.
    const sent = (await owner.query<{ body: string }>(`select body from notifications where tenant_id = $1 and template = 'shift_offer' and channel in ('email', 'sms')`, [ids.acme])).rows;
    for (const n of sent) {
      expect(n.body).toMatch(/\(about \d+ km from home\)/);
      expect(n.body).not.toMatch(/Richmond|3121|Example Street/);
    }
    await http().post(`/shifts/${ids.a2}/offers/withdraw`).set(as('sup')).send({}).expect(r => expect(r.status).toBeLessThan(300));
    // Not theirs to do: create, cancel, publish, templates, settings.
    await http().post('/shifts').set(as('sup')).send({ facilityId: ids.A, role: 'Carer', date: ahead(5), startTime: '07:00', endTime: '15:00' }).expect(403);
    await http().post(`/shifts/${ids.a2}/cancel`).set(as('sup')).send({ reason: 'x' }).expect(403);
    await http().post('/roster/publish').set(as('sup')).send({ weekStart: ahead(0) }).expect(403);
    await http().post('/roster/templates').set(as('sup')).send({}).expect(403);
    await http().patch('/settings').set(as('sup')).send({}).expect(403);
    // Business-wide numbers (answer 3).
    await http().get('/dashboard').set(as('sup')).expect(200);
    await http().get('/dashboard/live').set(as('sup')).expect(200);
    // A supervisor with no sites sees no shifts.
    expect(((await http().get(`/roster?from=${ahead(0)}&to=${ahead(10)}`).set(as('empty')).expect(200)).body.shifts as unknown[]).length).toBe(0);
    expect(((await http().get('/facilities').set(as('empty')).expect(200)).body as unknown[]).length).toBe(0);
  });

  it('enforces the limits in the database for direct queries as crop_app', async () => {
    const scoped = (sites: string[] | null, role: string, fn: Parameters<typeof withTenant>[2]) =>
      auditStore.run({ scope: { tenantId: ids.acme, role, sites } }, () => withTenant(pool, ids.acme, fn));
    const count = (table: string) => async (c: Parameters<Parameters<typeof withTenant>[2]>[0]) =>
      (await c.query(`select count(*)::int as n from ${table}`)).rows[0].n as number;
    expect(await scoped([ids.A], 'allocator', count('shifts'))).toBe(2);
    // Alpha's two (Ana pulled out, then back on); Bravo's (Ben) only without a limit.
    expect(await scoped([ids.A], 'allocator', count('shift_assignments'))).toBe(2);
    expect(await scoped(null, 'allocator', count('shift_assignments'))).toBe(3);
    expect(await scoped([], 'supervisor', count('shifts'))).toBe(0);
    expect(await scoped(null, 'allocator', count('shifts'))).toBe(3);
    // No store at all (background jobs): every site.
    expect(await withTenant(pool, ids.acme, count('shifts'))).toBe(3);
    // acrossSites opens every site for its function only.
    expect(await scoped([ids.A], 'allocator', async c => [await acrossSites(c, () => count('shifts')(c)), await count('shifts')(c)])).toEqual([3, 2]);
    // Writing another site's rows is refused.
    await expect(scoped([ids.A], 'allocator', c => c.query(`update shifts set notes = 'x' where facility_id = $1`, [ids.B]).then(r => r.rowCount))).resolves.toBe(0);
    await expect(scoped([ids.A], 'allocator', c => c.query(
      `insert into shifts(tenant_id, facility_id, role, starts_at, ends_at) values ($1, $2, 'Carer', now() + interval '9 days', now() + interval '9 days 8 hours')`,
      [ids.acme, ids.B]))).rejects.toThrow(/row-level security/);
    // Supervisors never reach addresses or the audit log; allocators do.
    expect(await scoped([ids.A], 'supervisor', count('worker_addresses'))).toBe(0);
    expect(await scoped([ids.A], 'supervisor', count('audit_log'))).toBe(0);
    expect(await scoped([ids.A], 'allocator', count('worker_addresses'))).toBe(1);
    // A scope for another business is ignored there, and tenant isolation holds.
    expect(await auditStore.run({ scope: { tenantId: ids.acme, role: 'allocator', sites: [ids.A] } }, () => withTenant(pool, ids.nosy, count('shifts')))).toBe(0);
    await http().get(`/shifts/${ids.a1}`).set(as('nosy')).expect(404);
  });

  it('keeps project stages to the people who see the project (migration 0093)', async () => {
    const proj = (await http().post('/facilities').set(as('admin')).send({ name: 'Gamma Project', kind: 'project', state: 'VIC' }).expect(201)).body.id;
    const v = (await http().post(`/projects/${proj}/stages`).set(as('admin')).send({ name: 'Fit-out', startsOn: ahead(10), endsOn: ahead(12), startTime: '07:00', endTime: '15:00', weekdays: [1, 2, 3, 4, 5, 6, 7] }).expect(201)).body;
    await http().put(`/project-stages/${v.id}/roles`).set(as('admin')).send({ roles: [{ role: 'Carer', count: 1 }] }).expect(200);
    const scoped = (sites: string[] | null, fn: Parameters<typeof withTenant>[2]) =>
      auditStore.run({ scope: { tenantId: ids.acme, role: 'allocator', sites } }, () => withTenant(pool, ids.acme, fn));
    for (const table of ['project_stages', 'project_stage_roles']) {
      const count = async (c: Parameters<Parameters<typeof withTenant>[2]>[0]) => (await c.query(`select count(*)::int as n from ${table}`)).rows[0].n as number;
      expect(await scoped([ids.A], count)).toBe(0);
      expect(await scoped([proj], count)).toBe(1);
      expect(await scoped(null, count)).toBe(1);
    }
    // Limited to Alpha: the project's stages aren't theirs.
    await http().get(`/projects/${proj}/stages`).set(as('lim')).expect(404);
  });

  it('stops equipment going to two places even when the other place is out of sight', async () => {
    const type = (await http().post('/equipment-types').set(as('admin')).send({ name: 'Hoist' }).expect(201)).body.id;
    const hoist = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: type, name: 'Hoist 1' }).expect(201)).body.id;
    await http().post(`/equipment/${hoist}/allocations`).set(as('admin')).send({ facilityId: ids.B, startsOn: ahead(1), endsOn: ahead(20) }).expect(201);
    const no = await http().post(`/equipment/${hoist}/allocations`).set(as('lim')).send({ facilityId: ids.A, startsOn: ahead(5) }).expect(409);
    expect(no.body.message).toMatch(/Hoist 1 is already allocated/);
    // And booking it on a shift at their site is blocked by the allocation elsewhere.
    await http().post(`/shifts/${ids.a2}/equipment`).set(as('lim')).send({ equipmentId: hoist }).expect(409);
    // Allocating to a site that isn't theirs is refused.
    const hoist2 = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: type, name: 'Hoist 2' }).expect(201)).body.id;
    const other = await http().post(`/equipment/${hoist2}/allocations`).set(as('lim')).send({ facilityId: ids.B, startsOn: ahead(5) });
    expect([400, 403, 404]).toContain(other.status);
  });
});
