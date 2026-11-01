import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { groupSummary, personReadiness, rankReadiness, readinessGroups, type RequirementLevel } from '../src/agencies/readiness.js';
import { startFakeIdp } from './fake-idp.js';

describe('agency readiness: rules', () => {
  const levels: RequirementLevel[] = [
    { requirementId: 'rsa', kind: 'role', label: 'Bartender', severity: 'hard' },
    { requirementId: 'ward', kind: 'role', label: 'Nurse', severity: 'warning' },
    { requirementId: 'fa', kind: 'everyone', label: 'Everyone', severity: 'hard' },
    { requirementId: 'barista', kind: 'everyone', label: 'Everyone', severity: 'optional' },
    { requirementId: 'rsa', kind: 'duty', label: 'Serves alcohol', severity: 'hard' },
  ];
  const employer = new Map([['rsa', 'RSA'], ['ward', 'Ward orientation'], ['fa', 'First aid'], ['barista', 'Barista course']]);
  const own = new Map([['own-rsa', 'Our RSA'], ['own-fa', 'Our first aid']]);
  const match = new Map([['rsa', 'own-rsa'], ['fa', 'own-fa']]);

  it('makes a group per role (with the rules for everyone) and per duty; optional ones are never checked', () => {
    const groups = readinessGroups(levels, match, own, employer);
    expect(groups.map(g => [g.kind, g.label, g.rules.map(r => `${r.typeName}:${r.severity}`), g.unmatched])).toEqual([
      ['role', 'Bartender', ['Our RSA:hard', 'Our first aid:hard'], []],
      ['role', 'Nurse', ['Our first aid:hard'], [{ name: 'Ward orientation', severity: 'warning' }]],
      ['duty', 'Serves alcohol', ['Our RSA:hard'], []],
    ]);
    // No role rules: one "Any role" group.
    expect(readinessGroups(levels.filter(l => l.kind !== 'role'), match, own, employer).map(g => g.label)).toEqual(['Any role', 'Serves alcohol']);
    expect(readinessGroups([], match, own, employer).map(g => [g.label, g.rules.length])).toEqual([['Any role', 0]]);
    // A link limited to some roles: just those, each with its own rules (if any) and everyone's.
    expect(readinessGroups(levels, match, own, employer, ['Nurse', 'Carer']).map(g => [g.label, g.rules.map(r => r.typeName)])).toEqual([
      ['Carer', ['Our first aid']], ['Nurse', ['Our first aid']], ['Serves alcohol', ['Our RSA']],
    ]);
  });

  it('checks a person: must-haves and right to work decide; should-haves and expiring ones are to check', () => {
    const [bar, nurse, duty] = readinessGroups(levels, match, own, employer);
    const rtw = { id: 'r', status: 'citizen' as const, verification: 'verified' as const, visaExpiry: null, vevoConfirmed: false };
    const fa = { id: 'c1', credentialTypeId: 'own-fa', expiryDate: '2026-11-10', verification: 'verified' as const };
    const p = { workerId: 'w', name: 'Ana Example', roles: ['nurse'] };
    const n = personReadiness(nurse, p, [fa], rtw, '2026-11-01', 30);
    expect(n).toMatchObject({ ready: true, hasRole: true, missing: [], toCheck: ['Our first aid: expires soon'] });
    const b = personReadiness(bar, p, [fa], rtw, '2026-11-01', 30);
    expect(b).toMatchObject({ ready: false, hasRole: false, missing: ['Our RSA: not recorded'] });
    expect(personReadiness(nurse, p, [fa], null, '2026-11-01', 30)).toMatchObject({ ready: false, missing: ['Right to work: not recorded'] });
    // Duties don't check right to work again.
    expect(personReadiness(duty, p, [], null, '2026-11-01', 30).missing).toEqual(['Our RSA: not recorded']);
    expect(groupSummary(nurse, [n, b])).toBe('1 of 2 ready');
    expect(rankReadiness([b, n]).map(x => x.ready)).toEqual([true, false]);
    // An unmatched must-have stops everyone.
    const [bar2] = readinessGroups(levels, new Map([['fa', 'own-fa']]), own, employer);
    expect(personReadiness(bar2, p, [fa], rtw, '2026-11-01', 30).ready).toBe(false);
    expect(groupSummary(bar2, [])).toBe('Nobody yet: match RSA first');
  });
});

describe('agency readiness: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  let link: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_agency_readiness');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(
      `insert into tenants(slug, name) values ('bayside','Bayside Hospital'),('cfy','Caring For You'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(
      `insert into invitations(tenant_id, email, role) values ($1,'emp@x.com','owner'),($2,'ag@x.com','admin'),($2,'agalloc@x.com','allocator'),($3,'nosy@x.com','owner')`,
      [ids.bayside, ids.cfy, ids.nosy]);
    for (const [sub, email] of [['emp', 'emp@x.com'], ['ag', 'ag@x.com'], ['agalloc', 'agalloc@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    const ct = await owner.query<{ id: string; name: string }>(
      `insert into credential_types(tenant_id, name, category, catalogue_code) values
         ($1, 'RSA', 'licence', 'au.responsible-service-of-alcohol-rsa'), ($1, 'First aid', 'training', null), ($1, 'Ward orientation', 'training', null)
       returning id, name`, [ids.bayside]);
    for (const r of ct.rows) ids[r.name] = r.id;
    await owner.query(
      `insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity) values
         ($1, $2, 'role', 'Bartender', 'hard'), ($1, $3, 'all_workers', null, 'hard'), ($1, $4, 'role', 'Nurse', 'warning')`,
      [ids.bayside, ids.RSA, ids['First aid'], ids['Ward orientation']]);
    const duty = (await owner.query<{ id: string }>(`insert into shift_duties(tenant_id, name) values ($1, 'Serves alcohol') returning id`, [ids.bayside])).rows[0].id;
    await owner.query(`insert into shift_duty_requirements(tenant_id, duty_id, credential_type_id, severity) values ($1, $2, $3, 'hard')`, [ids.bayside, duty, ids.RSA]);
    const own = await owner.query<{ id: string; name: string }>(
      `insert into credential_types(tenant_id, name, category, catalogue_code) values
         ($1, 'Responsible Service of Alcohol (RSA)', 'licence', 'au.responsible-service-of-alcohol-rsa'), ($1, 'First Aid (HLTAID011)', 'training', null)
       returning id, name`, [ids.cfy]);
    for (const r of own.rows) ids['own:' + r.name] = r.id;
    const person = async (first: string, roles: string[], creds: string[], rtw: boolean, status = 'active') => {
      const w = (await owner.query<{ id: string }>(
        `insert into workers(tenant_id, first_name, last_name, roles, status) values ($1,$2,'Example',$3,$4) returning id`, [ids.cfy, first, roles, status])).rows[0].id;
      if (rtw) await owner.query(`insert into right_to_work_records(tenant_id, worker_id, status, citizen_proof_type, verification) values ($1,$2,'citizen','au_passport','verified')`, [ids.cfy, w]);
      for (const c of creds) {
        await owner.query(`insert into worker_credentials(tenant_id, worker_id, credential_type_id, expiry_date, verification) values ($1,$2,$3,now()::date + 400,'verified')`, [ids.cfy, w, c]);
      }
      return w;
    };
    await person('Ana', ['Bartender'], [ids['own:Responsible Service of Alcohol (RSA)'], ids['own:First Aid (HLTAID011)']], true);
    await person('Ben', ['Nurse'], [ids['own:First Aid (HLTAID011)']], true);
    await person('Cara', ['Nurse'], [ids['own:First Aid (HLTAID011)']], false);
    await person('Dan', ['Nurse'], [ids['own:First Aid (HLTAID011)']], true, 'inactive');
    await owner.query(`insert into workers(tenant_id, first_name, last_name, roles) values ($1,'Bayside','Staff','{Nurse}')`, [ids.bayside]);

    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    delete process.env.APP_URL;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    const inv = (await http().post('/agency-links/invitations').set(as('emp')).send({}).expect(201)).body;
    link = (await http().post(`/agency-invites/${inv.token}/accept`).set(as('ag')).expect(200)).body.connectionId;
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  const view = async (who = 'agalloc') => (await http().get(`/agency-links/${link}/people`).set(as(who)).expect(200)).body;
  const group = (v: { groups: Array<{ label: string }> }, label: string) => v.groups.find(g => g.label === label) as unknown as {
    summary: string; ready: number; unmatched: Array<{ name: string }>; people: Array<{ name: string; ready: boolean; missing: string[]; toCheck: string[] }>;
  };

  it('before matching, must-haves stop everyone and say what to match', async () => {
    const v = await view();
    expect(v.peopleCount).toBe(3);
    expect(v.groups.map((g: { kind: string; label: string }) => [g.kind, g.label])).toEqual([['role', 'Bartender'], ['role', 'Nurse'], ['duty', 'Serves alcohol']]);
    expect(group(v, 'Bartender').summary).toBe('Nobody yet: match First aid, RSA first');
    expect(group(v, 'Nurse').ready).toBe(0);
  });

  it('after matching, shows who is ready for each role and duty, and why the rest are not', async () => {
    const reqs = (await http().get(`/agency-links/${link}/requirements`).set(as('ag')).expect(200)).body.requirements as Array<{ requirementId: string; name: string }>;
    const id = (n: string) => reqs.find(r => r.name === n)!.requirementId;
    await http().put(`/agency-links/${link}/matches`).set(as('ag')).send({ matches: [
      { requirementId: id('RSA'), credentialTypeId: ids['own:Responsible Service of Alcohol (RSA)'] },
      { requirementId: id('First aid'), credentialTypeId: ids['own:First Aid (HLTAID011)'] },
    ] }).expect(200);
    const v = await view();
    const bar = group(v, 'Bartender');
    expect(bar.summary).toBe('1 of 3 ready');
    expect(bar.people.map(p => [p.name, p.ready, p.missing])).toEqual([
      ['Ana Example', true, []],
      ['Ben Example', false, ['Responsible Service of Alcohol (RSA): not recorded']],
      ['Cara Example', false, ['Right to work: not recorded', 'Responsible Service of Alcohol (RSA): not recorded']],
    ]);
    const nurse = group(v, 'Nurse');
    expect(nurse.summary).toBe('2 of 3 ready');
    expect(nurse.unmatched).toEqual([{ name: 'Ward orientation', severity: 'warning' }]);
    expect(nurse.people[0]).toMatchObject({ name: 'Ben Example', ready: true });
    expect(group(v, 'Serves alcohol').people.filter(p => p.ready).map(p => p.name)).toEqual(['Ana Example']);
    expect(JSON.stringify(v)).not.toContain('Bayside Staff');
    expect(JSON.stringify(v)).not.toContain('Dan Example');
  });

  it('a link limited to some roles only needs the requirements for those roles (plus everyone and duties)', async () => {
    await owner.query(`insert into business_roles(tenant_id, name) values ($1, 'Bartender'), ($1, 'Nurse')`, [ids.bayside]);
    const reqNames = async () => ((await http().get(`/agency-links/${link}/requirements`).set(as('ag')).expect(200)).body as {
      link: { unmatched: number; status: string }; requirements: Array<{ name: string; neededFor: string[] }> });
    let r = await reqNames();
    expect(r.link).toMatchObject({ unmatched: 1, status: 'matching' });
    expect(r.requirements.map(q => q.name)).toContain('Ward orientation');

    // Only Bartender: Ward orientation (Nurse only) drops out, so the link is ready straight away.
    const patched = (await http().patch(`/agency-links/${link}`).set(as('emp')).send({ roles: ['Bartender'] }).expect(200)).body;
    expect(patched.status).toBe('active');
    r = await reqNames();
    expect(r.link).toMatchObject({ unmatched: 0, status: 'active' });
    expect(r.requirements.map(q => q.name)).toEqual(['First aid', 'RSA']);
    expect(r.requirements.find(q => q.name === 'RSA')!.neededFor).toEqual(['Bartender', 'Serves alcohol (duty)']);
    const v = await view();
    expect(v.groups.map((g: { label: string }) => g.label)).toEqual(['Bartender', 'Serves alcohol']);

    // Only Nurse: RSA is still needed for the duty; First aid for everyone.
    await http().patch(`/agency-links/${link}`).set(as('emp')).send({ roles: ['Nurse'] }).expect(200);
    r = await reqNames();
    expect(r.requirements.find(q => q.name === 'RSA')!.neededFor).toEqual(['Serves alcohol (duty)']);
    expect(r.link).toMatchObject({ unmatched: 1, status: 'matching' });

    // Every role again: back to needing Ward orientation.
    const back = (await http().patch(`/agency-links/${link}`).set(as('emp')).send({ roles: null }).expect(200)).body;
    expect(back.status).toBe('matching');
    const events = (await http().get(`/agency-links/${link}/events`).set(as('ag')).expect(200)).body as Array<{ action: string }>;
    expect(events.filter(e => e.action === 'matched').length).toBeGreaterThan(0);
  });

  it('only the agency side of the link; another business sees nothing', async () => {
    expect((await http().get(`/agency-links/${link}/people`).set(as('emp')).expect(400)).body.message).toMatch(/Only the agency/);
    await http().get(`/agency-links/${link}/people`).set(as('nosy')).expect(404);
    // The levels function itself refuses the employer side and other businesses.
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      for (const [tenant, msg] of [[ids.bayside, /Only the agency/], [ids.nosy, /Link not found/]] as const) {
        await c.query('begin');
        await c.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
        await expect(c.query('select * from app_agency_requirement_levels($1)', [link])).rejects.toThrow(msg);
        await c.query('rollback');
      }
    } finally {
      await c.end();
    }
  });
});
