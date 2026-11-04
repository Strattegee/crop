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
import {
  allocatedElsewhere, covers, kindAndStatus, projectDates, rangeLine, rangesOverlap, teamFirst,
} from '../src/projects/projects.js';
import { startFakeIdp } from './fake-idp.js';

describe('projects: rules (David and Steve, 4 Nov)', () => {
  it('compares date ranges with open ends', () => {
    expect(rangesOverlap({ from: '2026-11-09', to: '2026-11-20' }, { from: '2026-11-20', to: null })).toBe(true);
    expect(rangesOverlap({ from: '2026-11-09', to: '2026-11-19' }, { from: '2026-11-20', to: null })).toBe(false);
    expect(rangesOverlap({ from: '2026-11-09', to: null }, { from: '2026-01-01', to: '2026-11-09' })).toBe(true);
    expect(covers({ from: '2026-11-09', to: null }, '2030-01-01')).toBe(true);
    expect(covers({ from: '2026-11-09', to: '2026-11-10' }, '2026-11-11')).toBe(false);
  });

  it('keeps a project’s status and active flag together', () => {
    const today = '2026-11-04';
    expect(kindAndStatus(null, {}, today)).toEqual({ kind: 'site', status: null, active: true });
    expect(kindAndStatus(null, { kind: 'project' }, today)).toEqual({ kind: 'project', status: 'active', active: true });
    expect(kindAndStatus(null, { kind: 'project', startsOn: '2026-12-01' }, today)).toEqual({ kind: 'project', status: 'planned', active: true });
    const live = { kind: 'project' as const, status: 'active' as const, active: true };
    expect(kindAndStatus(live, { status: 'archived' }, today)).toEqual({ kind: 'project', status: 'archived', active: false });
    expect(kindAndStatus(live, { active: false }, today)).toEqual({ kind: 'project', status: 'archived', active: false });
    expect(kindAndStatus({ ...live, status: 'archived', active: false }, { active: true }, today)).toEqual({ kind: 'project', status: 'active', active: true });
    expect(kindAndStatus(live, { kind: 'site' }, today)).toEqual({ kind: 'site', status: null, active: true });
  });

  it('blocks equipment allocated to another place on the shift’s date', () => {
    const a = [{ id: 'a', facilityId: 'P', siteName: 'Smith St job', from: '2026-11-09', to: '2026-11-20' }];
    expect(allocatedElsewhere('Excavator 2', 'Q', '2026-11-10', a)).toBe('Excavator 2 is allocated to Smith St job until Fri 20 Nov');
    expect(allocatedElsewhere('Excavator 2', 'P', '2026-11-10', a)).toBeNull();
    expect(allocatedElsewhere('Excavator 2', 'Q', '2026-11-21', a)).toBeNull();
    expect(allocatedElsewhere('Excavator 2', 'Q', '2026-11-10', [{ ...a[0], to: null }])).toBe('Excavator 2 is allocated to Smith St job');
  });

  it('puts the team first without changing who can work', () => {
    const c = (id: string, onTeam: boolean, eligible = true, warnings: string[] = []) => ({ id, onTeam, eligible, warnings, available: true });
    expect(teamFirst([c('a', false), c('b', true), c('x', true, false), c('w', true, true, ['rest'])]).map(x => x.id)).toEqual(['b', 'a', 'w', 'x']);
  });

  it('words dates', () => {
    expect(projectDates('2026-11-09', '2027-04-30')).toBe('Mon 9 Nov – Fri 30 Apr');
    expect(projectDates(null, '2027-04-30')).toBe('Due Fri 30 Apr');
    expect(projectDates(null, null)).toBeNull();
    expect(rangeLine({ from: '2026-11-01', to: null }, '2026-11-04')).toBe('No end date');
    expect(rangeLine({ from: '2026-11-09', to: null }, '2026-11-04')).toBe('From Mon 9 Nov');
    expect(rangeLine({ from: '2026-11-01', to: '2026-11-03' }, '2026-11-04')).toBe('Ended Tue 3 Nov');
  });
});

describe('projects: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const mkShift = async (facilityId: string, date: string) =>
    (await http().post('/shifts').set(as('alloc')).send({ facilityId, role: 'Labourer', date, startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0] as string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_projects');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('build','Example Builders'),('nosy','Nosy Co') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'nosy@x.com','owner')`, [ids.build, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: sub === 'alloc' ? 'Alex Allocator' : undefined });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    for (const who of ['admin', 'alloc', 'worker', 'nosy']) await http().get('/me').set(as(who)).expect(200);
    ids.allocUser = (await owner.query<{ id: string }>(`select id from users where email = 'alloc@x.com'`)).rows[0].id;
    ids.workerUser = (await owner.query<{ id: string }>(`select id from users where email = 'w@x.com'`)).rows[0].id;
    for (const [k, first] of [['ana', 'Ana'], ['ben', 'Ben']]) {
      ids[k] = (await http().post('/workers').set(as('admin')).send({ firstName: first, lastName: 'Example', roles: ['Labourer'] }).expect(201)).body.id;
      await http().put(`/workers/${ids[k]}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${ids[k]}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    }
    ids.yard = (await http().post('/facilities').set(as('admin')).send({ name: 'Home Yard', state: 'VIC' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('sets up a project as a site of kind project', async () => {
    const p = (await http().post('/facilities').set(as('admin')).send({
      name: 'Smith St Apartments', kind: 'project', code: 'P-2041', description: 'Six-storey build', state: 'VIC',
      startsOn: ahead(-30), endsOn: ahead(150), managerUserId: ids.allocUser,
    }).expect(201)).body;
    expect(p).toMatchObject({ kind: 'project', code: 'P-2041', status: 'active', active: true, managerName: 'Alex Allocator', endsOn: ahead(150) });
    ids.smith = p.id;
    await http().post('/facilities').set(as('admin')).send({ name: 'Copy', kind: 'project', code: 'p-2041' }).expect(400);
    await http().post('/facilities').set(as('admin')).send({ name: 'Bad', status: 'active' }).expect(400); // a site has no status
    await http().post('/facilities').set(as('admin')).send({ name: 'Bad', kind: 'project', managerUserId: ids.workerUser }).expect(400);
    await http().post('/facilities').set(as('admin')).send({ name: 'Bad', kind: 'project', startsOn: '2026-12-01', endsOn: '2026-11-01' }).expect(400);
    ids.later = (await http().post('/facilities').set(as('admin')).send({ name: 'Bridge Rd', kind: 'project', startsOn: ahead(40) }).expect(201)).body.id;
    for (const name of ['Level 1', 'Level 2']) {
      ids[name] = (await http().post(`/facilities/${ids.smith}/areas`).set(as('admin')).send({ name }).expect(201)).body.id;
    }

    const list = (await http().get('/projects').set(as('alloc')).expect(200)).body as { name: string; statusLabel: string; areaCount: number }[];
    expect(list.map(x => `${x.name}:${x.statusLabel}:${x.areaCount}`)).toEqual(['Smith St Apartments:Active:2', 'Bridge Rd:Planned:0']);
    expect(((await http().get('/facilities?kind=project').set(as('alloc')).expect(200)).body as unknown[]).length).toBe(2);
    expect(((await http().get('/facilities?kind=site').set(as('alloc')).expect(200)).body as { name: string }[]).map(f => f.name)).toEqual(['Home Yard']);

    // Archiving keeps everything and leaves the pickers; bringing it back makes it active again.
    expect((await http().patch(`/facilities/${ids.later}`).set(as('admin')).send({ status: 'archived' }).expect(200)).body).toMatchObject({ status: 'archived', active: false });
    expect(((await http().get('/projects').set(as('alloc')).expect(200)).body as unknown[]).length).toBe(1);
    expect(((await http().get('/projects?status=archived').set(as('alloc')).expect(200)).body as { name: string }[]).map(x => x.name)).toEqual(['Bridge Rd']);
    expect((await http().patch(`/facilities/${ids.later}`).set(as('admin')).send({ active: true }).expect(200)).body).toMatchObject({ status: 'active', active: true });
    await http().get('/projects').set(as('worker')).expect(403);
  });

  it('keeps a team separately from shifts, and puts it first among candidates', async () => {
    const m = (await http().post(`/facilities/${ids.smith}/team`).set(as('alloc'))
      .send({ workerId: ids.ben, teamRole: 'supervisor', areaId: ids['Level 1'], startsOn: ahead(-10) }).expect(201)).body;
    expect(m).toMatchObject({ name: 'Ben Example', teamRole: 'supervisor', areaName: 'Level 1', state: 'current', line: 'No end date' });
    ids.benMember = m.id;
    const clash = await http().post(`/facilities/${ids.smith}/team`).set(as('alloc')).send({ workerId: ids.ben, startsOn: ahead(5) }).expect(409);
    expect(clash.body.message).toBe('They are already on that team for some of those dates');
    await http().post(`/facilities/${ids.smith}/team`).set(as('alloc')).send({ workerId: ids.ana, areaId: ids.yard }).expect(400);
    await http().post(`/facilities/${ids.smith}/team`).set(as('worker')).send({ workerId: ids.ana }).expect(403);
    // Ben can be on another project's team too: one person record across projects.
    await http().post(`/facilities/${ids.later}/team`).set(as('alloc')).send({ workerId: ids.ben, startsOn: ahead(40) }).expect(201);
    const teams = (await http().get(`/workers/${ids.ben}/teams`).set(as('alloc')).expect(200)).body as { siteName: string; state: string }[];
    expect(teams.map(x => `${x.siteName}:${x.state}`)).toEqual(['Bridge Rd:upcoming', 'Smith St Apartments:current']);

    // Both can work it; Ben has more hours this week so normally comes second, but he's on the team.
    const busy = await mkShift(ids.yard, ahead(2));
    await http().post(`/shifts/${busy}/assign`).set(as('alloc')).send({ workerId: ids.ben }).expect(200);
    const s = await mkShift(ids.smith, ahead(3));
    const c = (await http().get(`/shifts/${s}/candidates`).set(as('alloc')).expect(200)).body.candidates as { name: string; eligible: boolean; team: { teamRole: string } | null }[];
    expect(c.map(x => `${x.name}:${x.eligible}:${x.team?.teamRole ?? '-'}`)).toEqual(['Ben Example:true:supervisor', 'Ana Example:true:-']);
    const elsewhere = await mkShift(ids.yard, ahead(3));
    const c2 = (await http().get(`/shifts/${elsewhere}/candidates`).set(as('alloc')).expect(200)).body.candidates as { name: string; team: unknown }[];
    expect(c2.map(x => x.name)[0]).toBe('Ana Example');
    expect(c2.every(x => x.team === null)).toBe(true);
    const bank = (await http().get(`/shifts/${s}/bank-fill?everyone=true`).set(as('alloc')).expect(200)).body.candidates as { name: string }[];
    expect(bank[0].name).toBe('Ben Example');

    // Ending and taking off.
    expect((await http().patch(`/site-members/${ids.benMember}`).set(as('alloc')).send({ endsOn: ahead(200), teamRole: 'worker' }).expect(200)).body)
      .toMatchObject({ teamRole: 'worker', endsOn: ahead(200) });
    await http().patch(`/site-members/${ids.benMember}`).set(as('alloc')).send({ endsOn: ahead(-20) }).expect(400);
    const ana = (await http().post(`/facilities/${ids.smith}/team`).set(as('alloc')).send({ workerId: ids.ana }).expect(201)).body;
    await http().post(`/site-members/${ana.id}/remove`).set(as('alloc')).send({ reason: 'Wrong person' }).expect(201);
    expect(((await http().get(`/facilities/${ids.smith}/team`).set(as('alloc')).expect(200)).body as { name: string }[]).map(x => x.name)).toEqual(['Ben Example']);
    const audit = await owner.query(`select action from audit_log where table_name = 'site_members' and row_id = $1 order by id`, [ana.id]);
    expect(audit.rows.map(r => r.action)).toEqual(['insert', 'update']);
  });

  it('allocates equipment to one place at a time and blocks bookings elsewhere', async () => {
    const type = (await http().post('/equipment-types').set(as('admin')).send({ name: 'Excavator' }).expect(201)).body.id;
    ids.ex1 = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: type, name: 'Excavator 1' }).expect(201)).body.id;
    ids.ex2 = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: type, name: 'Excavator 2' }).expect(201)).body.id;

    const a = (await http().post(`/equipment/${ids.ex1}/allocations`).set(as('alloc'))
      .send({ facilityId: ids.smith, areaId: ids['Level 2'], startsOn: ahead(-5), endsOn: ahead(20) }).expect(201)).body;
    expect(a).toMatchObject({ equipmentName: 'Excavator 1', siteName: 'Smith St Apartments', areaName: 'Level 2', state: 'current' });
    ids.alloc1 = a.id;
    const clash = await http().post(`/equipment/${ids.ex1}/allocations`).set(as('alloc')).send({ facilityId: ids.yard, startsOn: ahead(10) }).expect(409);
    expect(clash.body.message).toMatch(/^Excavator 1 is already allocated to Smith St Apartments from /);

    // Booking it on a shift at another place while it's allocated is a hard block; at the project it's fine.
    const yardShift = await mkShift(ids.yard, ahead(4));
    const no = await http().post(`/shifts/${yardShift}/equipment`).set(as('alloc')).send({ equipmentId: ids.ex1 }).expect(409);
    expect(no.body.message).toMatch(/^Excavator 1 is allocated to Smith St Apartments until /);
    const cands = (await http().get(`/shifts/${yardShift}/equipment-candidates`).set(as('alloc')).expect(200)).body.candidates as { name: string; eligible: boolean }[];
    expect(cands.map(x => `${x.name}:${x.eligible}`)).toEqual(['Excavator 2:true', 'Excavator 1:false']);
    const smithShift = await mkShift(ids.smith, ahead(4));
    await http().post(`/shifts/${smithShift}/equipment`).set(as('alloc')).send({ equipmentId: ids.ex1 }).expect(200);
    // After the allocation ends it can go anywhere.
    const after = await mkShift(ids.yard, ahead(25));
    await http().post(`/shifts/${after}/equipment`).set(as('alloc')).send({ equipmentId: ids.ex1 }).expect(200);

    // Excavator 2 is booked at the yard, so it can't be allocated to the project over that date.
    await http().post(`/shifts/${yardShift}/equipment`).set(as('alloc')).send({ equipmentId: ids.ex2 }).expect(200);
    const booked = await http().post(`/equipment/${ids.ex2}/allocations`).set(as('alloc')).send({ facilityId: ids.smith }).expect(409);
    expect(booked.body.message).toMatch(/^Excavator 2 is booked on 1 shift at other places in those dates \(first: .* at Home Yard\)\. Take it off that shift first\.$/);
    expect((await http().post(`/equipment/${ids.ex2}/allocations`).set(as('alloc')).send({ facilityId: ids.smith, startsOn: ahead(5) }).expect(201)).body.line).toMatch(/^From /);

    // Extending Excavator 1 past the yard booking on day 25 is refused; moving it to the yard from day 15 works.
    await http().post(`/equipment-allocations/${ids.alloc1}/end`).set(as('alloc')).send({ lastDay: ahead(30) }).expect(409);
    await http().post(`/equipment-allocations/${ids.alloc1}/end`).set(as('alloc')).send({ lastDay: ahead(-10) }).expect(400);
    await http().post(`/equipment-allocations/${ids.alloc1}/move`).set(as('alloc')).send({ facilityId: ids.yard, onDate: ahead(21) }).expect(400);
    const moved = (await http().post(`/equipment-allocations/${ids.alloc1}/move`).set(as('alloc')).send({ facilityId: ids.yard, onDate: ahead(15) }).expect(201)).body;
    expect(moved.ended.endsOn).toBe(ahead(14));
    expect(moved.started).toMatchObject({ siteName: 'Home Yard', startsOn: ahead(15), endsOn: ahead(20) });
    const where = (await http().get(`/equipment/${ids.ex1}/allocations`).set(as('alloc')).expect(200)).body as { siteName: string }[];
    expect(where.map(x => x.siteName)).toEqual(['Home Yard', 'Smith St Apartments']);
    await http().post(`/equipment-allocations/${moved.started.id}/remove`).set(as('alloc')).send({}).expect(201);
    expect(((await http().get(`/equipment/${ids.ex1}/allocations`).set(as('alloc')).expect(200)).body as unknown[]).length).toBe(1);
  });

  it('gives a project overview', async () => {
    const o = (await http().get(`/projects/${ids.smith}`).set(as('alloc')).expect(200)).body;
    expect(o).toMatchObject({ name: 'Smith St Apartments', statusLabel: 'Active', managerName: 'Alex Allocator', counts: { team: 1, equipment: 1 } });
    expect(o.areas.map((a: { name: string }) => a.name)).toEqual(['Level 1', 'Level 2']);
    expect(o.days).toHaveLength(2);
    expect(o.equipment.map((e: { equipmentName: string; state: string }) => `${e.equipmentName}:${e.state}`)).toEqual(['Excavator 1:current', 'Excavator 2:upcoming']);
    const items = (await http().get(`/facilities/${ids.smith}/items`).set(as('alloc')).expect(200)).body;
    expect(items).toMatchObject({ lines: [], totalCostCents: 0 });
  });

  it('keeps every business’s projects apart', async () => {
    await http().get(`/projects/${ids.smith}`).set(as('nosy')).expect(404);
    await http().get(`/facilities/${ids.smith}/team`).set(as('nosy')).expect(404);
    expect((await http().get('/projects').set(as('nosy')).expect(200)).body).toEqual([]);
    await http().post(`/site-members/${ids.benMember}/remove`).set(as('nosy')).send({}).expect(404);
    await http().post(`/equipment-allocations/${ids.alloc1}/end`).set(as('nosy')).send({ lastDay: null }).expect(404);
    const pool = new Pool({ connectionString: db.appUrl });
    try {
      const seen = await withTenant(pool, ids.nosy, async c => [
        (await c.query('select count(*)::int as n from site_members')).rows[0].n,
        (await c.query('select count(*)::int as n from equipment_site_allocations')).rows[0].n,
      ]);
      expect(seen).toEqual([0, 0]);
      const mine = await withTenant(pool, ids.build, async c => (await c.query('select count(*)::int as n from site_members')).rows[0].n);
      expect(mine).toBeGreaterThan(0);
      // crop_app can never delete or rewrite them.
      await expect(withTenant(pool, ids.build, c => c.query('delete from site_members'))).rejects.toThrow(/permission denied/);
      await expect(withTenant(pool, ids.build, c => c.query(`update equipment_site_allocations set facility_id = $1`, [ids.yard]))).rejects.toThrow(/permission denied/);
    } finally {
      await pool.end();
    }
  });
});
