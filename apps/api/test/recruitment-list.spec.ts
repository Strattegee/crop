import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import {
  ACTIVE_STAGES, docProgress, listPage, matches, needsAction, parseListQuery, sortPeople, stageCounts, type ListPerson,
} from '../src/workforce/recruitment-list.js';
import type { RequirementRule } from '../src/workforce/compliance.js';
import { startFakeIdp } from './fake-idp.js';

const person = (over: Partial<ListPerson> = {}): ListPerson => ({
  id: over.id ?? Math.random().toString(36).slice(2), firstName: 'Ana', lastName: 'Example', preferredName: null, email: 'ana@example.com',
  phone: '+61412345678', roles: ['Carer'], stage: 'applied', appliedAt: '2026-11-01T00:00:00Z', movedAt: '2026-11-01T00:00:00Z', days: 2,
  source: 'office', workTypes: [], suburb: 'Geelong', region: 'VIC', postcode: '3220', docs: { done: 0, total: 2, toCheck: 0, missing: 2 }, ...over,
});

describe('recruitment list rules (David, 5 Nov)', () => {
  const rules: RequirementRule[] = [
    { credentialTypeId: 'police', typeName: 'Police check', scope: 'all_workers', role: null, severity: 'hard' },
    { credentialTypeId: 'reg', typeName: 'Registration', scope: 'role', role: 'Nurse', severity: 'hard' },
    { credentialTypeId: 'fa', typeName: 'First aid', scope: 'all_workers', role: null, severity: 'warning' },
  ];

  it('reads the query, ignoring what it does not know', () => {
    const f = parseListQuery({ stage: 'applied,nope', role: ['Carer', 'Nurse'], work: 'casual,weekly', docs: 'to_check', waiting: '9', sort: '-applied', limit: '99999' });
    expect(f).toMatchObject({ stages: ['applied'], roles: ['Carer', 'Nurse'], workTypes: ['casual'], docs: 'to_check', waiting: null, sort: 'applied', desc: true, limit: 5000 });
    expect(parseListQuery({}).stages).toEqual([...ACTIVE_STAGES]);
    expect(parseListQuery({ near: 'not-a-uuid', km: '-3' })).toMatchObject({ near: null, km: null, limit: 100 });
  });

  it('counts must-haves for their roles plus right to work', () => {
    expect(docProgress(['Carer'], rules, [{ severity: 'hard', problem: 'missing' }, { severity: 'hard', problem: 'missing' }]))
      .toEqual({ done: 0, total: 2, toCheck: 0, missing: 2 });
    expect(docProgress(['Nurse'], rules, [{ severity: 'hard', problem: 'unverified' }, { severity: 'hard', problem: 'expiring' }, { severity: 'warning', problem: 'missing' }]))
      .toEqual({ done: 2, total: 3, toCheck: 1, missing: 0 });
  });

  it('needs action: documents to check, or a week without a move', () => {
    expect(needsAction(person({ days: 2 }))).toBe(false);
    expect(needsAction(person({ days: 7 }))).toBe(true);
    expect(needsAction(person({ docs: { done: 1, total: 2, toCheck: 1, missing: 0 } }))).toBe(true);
    expect(needsAction(person({ stage: 'started', days: 20 }))).toBe(false);
  });

  it('filters by every column', () => {
    const f = (q: Record<string, unknown>) => parseListQuery(q);
    const p = person({ roles: ['Nurse'], workTypes: ['casual'], source: 'online' });
    expect(matches(p, f({ role: 'Nurse', work: 'casual', state: 'vic', place: 'geel', source: 'online' }))).toBe(true);
    expect(matches(p, f({ role: 'Carer' }))).toBe(false);
    expect(matches(p, f({ work: 'full_time' }))).toBe(false);
    expect(matches(p, f({ state: 'NSW' }))).toBe(false);
    expect(matches(p, f({ place: '3000' }))).toBe(false);
    expect(matches(p, f({ docs: 'none' }))).toBe(true);
    expect(matches(p, f({ docs: 'done' }))).toBe(false);
    expect(matches(p, f({ waiting: '3' }))).toBe(false);
    expect(matches(person({ days: 4 }), f({ waiting: '3' }))).toBe(true);
    expect(matches(p, f({ q: 'exam' }))).toBe(true);
    expect(matches(p, f({ q: '0412 345' }))).toBe(true);
    expect(matches(p, f({ q: 'zed' }))).toBe(false);
    expect(matches(person({ stage: 'started' }), f({}))).toBe(false);
    expect(matches(person({ stage: 'started' }), f({}), true)).toBe(true);
    expect(matches(person({ distanceKm: 30 }), { ...f({ near: '00000000-0000-4000-8000-000000000000' }), km: 25 })).toBe(false);
    expect(matches(person({ distanceKm: 12 }), { ...f({ near: '00000000-0000-4000-8000-000000000000' }), km: 25 })).toBe(true);
  });

  it('counts each stage with the other filters, and sorts new applications first by default', () => {
    const list = [
      person({ id: 'a', stage: 'applied', movedAt: '2026-11-01T00:00:00Z' }),
      person({ id: 'b', stage: 'applied', movedAt: '2026-11-03T00:00:00Z' }),
      person({ id: 'c', stage: 'interview', days: 1 }),
      person({ id: 'd', stage: 'interview', days: 9, roles: ['Nurse'] }),
      person({ id: 'e', stage: 'started' }),
    ];
    expect(stageCounts(list, parseListQuery({ role: 'Carer' }))).toMatchObject({ applied: 2, interview: 1, started: 1, offer: 0 });
    expect(sortPeople(list, 'default', false).map(p => p.id)).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(sortPeople(list, 'days', true).map(p => p.id)[0]).toBe('d');
    const page = listPage(list, parseListQuery({ limit: '2' }));
    expect(page).toMatchObject({ total: 4, more: 2 });
    expect(page.rows.map(r => r.id)).toEqual(['b', 'a']);
  });
});

describe('recruitment list end to end', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  type Res = { rows: Array<{ id: string; firstName: string; stage: string; docs: { done: number; total: number; toCheck: number }; distanceKm?: number | null; progress: unknown }>;
    total: number; more: number; counts: Record<string, number>; states: { value: string; count: number }[] };
  const list = async (q = '') => (await http().get(`/recruitment/list${q}`).set(as('alloc')).expect(200)).body as Res;
  let site: string;
  const N = 400;

  beforeAll(async () => {
    db = await createTestDatabase('crop_recruitment_list');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('care','Demo Care'),('other','Other') returning id`);
    const tenant = t.rows[0].id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`,
      [tenant, t.rows[1].id]);
    for (const [sub, email] of [['owner', 'owner@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    site = (await http().post('/facilities').set(as('owner')).send({ name: 'Bayside House', state: 'VIC', postcode: '3000' }).expect(201)).body.id;
    const police = (await http().post('/credential-types').set(as('owner')).send({ name: 'Police check', category: 'check', hasNumber: false, hasExpiry: false }).expect(201)).body.id;
    await owner.query(`insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity) values ($1,$2,'all_workers',null,'hard')`, [tenant, police]);

    // A few hundred invented applicants: stages, roles, places and documents spread across them.
    const stages = ['applied', 'screening', 'interview', 'offer'];
    const ids = (await owner.query<{ id: string }>(
      `insert into workers(tenant_id, first_name, last_name, email, status, roles, recruitment_stage, stage_changed_at)
       select $1, 'Person' || g, 'Example', 'p' || g || '@example.com', 'applicant',
              case when g % 3 = 0 then array['Nurse'] else array['Carer'] end,
              ($2::text[])[1 + g % 4], now() - make_interval(days => g % 20)
         from generate_series(1, $3) g order by g returning id`, [tenant, stages, N])).rows.map(r => r.id);
    await owner.query(
      `insert into worker_addresses(tenant_id, worker_id, line1, suburb, region, postcode, country, is_current)
       select $1, w, 'From their application', case when n % 2 = 0 then 'Melbourne' else 'Sydney' end,
              case when n % 2 = 0 then 'VIC' else 'NSW' end, case when n % 2 = 0 then '3000' else '2000' end, 'AU', true
         from unnest($2::uuid[]) with ordinality as x(w, n)`, [tenant, ids]);
    await owner.query(
      `insert into worker_credentials(tenant_id, worker_id, credential_type_id, verification)
       select $1, w, $3, case when n % 10 = 0 then 'verified'::text else 'unverified' end::verification_status
         from unnest($2::uuid[]) with ordinality as x(w, n) where n % 5 = 0`, [tenant, ids, police]);
    await owner.end();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lists everyone in recruitment, a page at a time, quickly', async () => {
    const started = Date.now();
    const r = await list();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.total).toBe(N);
    expect(r.rows).toHaveLength(100);
    expect(r.more).toBe(N - 100);
    expect(r.counts).toMatchObject({ applied: 100, screening: 100, interview: 100, offer: 100, onboarding: 0 });
    // New applications first, newest first.
    expect(r.rows[0].stage).toBe('applied');
    expect(r.states).toEqual([{ value: 'NSW', count: 200 }, { value: 'VIC', count: 200 }]);
    expect(r.rows[0].docs.total).toBe(2);
  });

  it('filters in the API: stage, role, state, documents, waiting, search', async () => {
    const applied = await list('?stage=applied');
    expect(applied.total).toBe(100);
    expect(applied.rows.every(p => p.stage === 'applied')).toBe(true);
    expect((await list('?role=Nurse')).total).toBe(133);
    // Stage counts ignore the stage filter but keep the others.
    expect((await list('?stage=offer&role=Nurse')).counts.applied).toBe((await list('?stage=applied&role=Nurse')).total);
    expect((await list('?state=VIC')).total).toBe(200);
    expect((await list('?place=sydney')).total).toBe(200);
    const toCheck = await list('?docs=to_check');
    expect(toCheck.total).toBe(40);
    expect(toCheck.rows.every(p => p.docs.toCheck === 1)).toBe(true);
    expect((await list('?docs=none')).total).toBe(N - 40);
    expect((await list('?waiting=14')).rows.length).toBeGreaterThan(0);
    expect((await list('?waiting=action')).total).toBeGreaterThan(40);
    expect((await list('?q=person17')).rows.map(p => p.firstName)).toContain('Person17');
    const near = await list(`?near=${site}&km=10`);
    expect(near.total).toBe(200);
    expect(near.rows.every(p => p.distanceKm !== null && p.distanceKm! <= 10)).toBe(true);
  });

  it('pages on, sorts by name, and shows not proceeding only when asked', async () => {
    expect((await list('?limit=350')).rows).toHaveLength(350);
    const byName = await list('?sort=name&limit=3');
    expect(byName.rows.map(r => r.firstName)).toEqual(['Person1', 'Person10', 'Person100']);
    const first = byName.rows[0].id;
    await http().post(`/workers/${first}/stage`).set(as('alloc')).send({ stage: 'not_proceeding', note: 'Took another job' }).expect(200);
    expect((await list()).total).toBe(N - 1);
    const np = await list('?stage=not_proceeding');
    expect(np.rows.map(r => r.id)).toEqual([first]);
    expect(np.counts.not_proceeding).toBe(1);
  });

  it('is for the office only', async () => {
    await http().get('/recruitment/list').set(as('worker')).expect(403);
    expect((await http().get('/recruitment/list').set(as('other')).expect(200)).body.total).toBe(0);
  });
});
