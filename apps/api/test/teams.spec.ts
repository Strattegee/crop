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
import { makeWords } from '../src/terms/words.js';
import {
  joinRefusal, leaving, makeUpLine, memberState, parseMakeUp, shortLine, shortTodayLine, sortMembers, teamGaps,
} from '../src/teams/teams.js';
import { startFakeIdp } from './fake-idp.js';

describe('standing teams: rules (David, 5 Nov)', () => {
  const known = ['Carpenter', 'Plasterer', 'Painter', 'Cleaner'];

  it('reads a make-up of roles and counts', () => {
    expect(parseMakeUp([{ role: ' Carpenter ', count: 2 }, { role: 'Painter', count: 1 }], known))
      .toEqual({ roles: [{ role: 'Carpenter', count: 2 }, { role: 'Painter', count: 1 }] });
    expect(parseMakeUp([], known)).toEqual({ roles: [] });
    expect(parseMakeUp('Carpenter', known)).toEqual({ problem: 'Give the roles as a list' });
    expect(parseMakeUp([{ role: 'carpenter', count: 1 }], known)).toEqual({ problem: "carpenter isn't one of your roles" });
    expect(parseMakeUp([{ role: 'Carpenter', count: 0 }], known)).toEqual({ problem: 'How many Carpenter: a whole number from 1 to 99' });
    expect(parseMakeUp([{ role: 'Carpenter', count: 1.5 }], known)).toHaveProperty('problem');
    expect(parseMakeUp([{ role: 'Carpenter', count: 1 }, { role: 'Carpenter', count: 2 }], known)).toEqual({ problem: 'Carpenter is listed twice' });
    expect(parseMakeUp([{ count: 1 }], known)).toEqual({ problem: 'Choose a role for each line' });
    const w = makeWords([{ code: 1055, singular: 'Trade', plural: 'Trades' }]);
    expect(parseMakeUp([{ role: 'Welder', count: 1 }], known, w)).toEqual({ problem: "Welder isn't one of your trades" });
  });

  it('lets only active people join, in a role they have', () => {
    expect(joinRefusal({ name: 'Ana Example', status: 'active', roles: ['Carpenter'] }, 'Carpenter')).toBeNull();
    expect(joinRefusal({ name: 'Ana Example', status: 'active', roles: ['Carpenter'] }, 'Painter'))
      .toBe("Ana Example doesn't have the role Painter. Add it on their page first.");
    expect(joinRefusal({ name: 'Ana Example', status: 'inactive', roles: ['Carpenter'] }, 'Carpenter'))
      .toBe("Only active workers can join a team. Ana Example isn't active.");
    const w = makeWords([{ code: 1035, singular: 'Crew', plural: 'Crews' }, { code: 1010, singular: 'Tradie', plural: 'Tradies' }]);
    expect(joinRefusal({ name: 'Ben', status: 'onboarding', roles: [] }, 'Painter', w)).toBe("Only active tradies can join a crew. Ben isn't active.");
  });

  it('counts gaps: places nobody fills, and people away today', () => {
    const makeUp = [{ role: 'Carpenter', count: 2 }, { role: 'Plasterer', count: 2 }, { role: 'Painter', count: 1 }];
    const m = (role: string, extra: Partial<{ state: 'current' | 'upcoming' | 'ended'; active: boolean; onLeave: boolean }> = {}) =>
      ({ role, state: 'current' as const, active: true, onLeave: false, ...extra });
    const gaps = teamGaps(makeUp, [
      m('Carpenter'), m('Carpenter', { onLeave: true }), m('Plasterer'), m('Plasterer', { active: false }),
      m('Painter', { state: 'upcoming' }), m('Cleaner'),
    ]);
    expect(gaps).toEqual([
      { role: 'Carpenter', needed: 2, named: 2, here: 1, short: 0, shortToday: 1 },
      { role: 'Plasterer', needed: 2, named: 1, here: 1, short: 1, shortToday: 1 },
      { role: 'Painter', needed: 1, named: 0, here: 0, short: 1, shortToday: 1 },
    ]);
    expect(shortLine(gaps)).toBe('Short: 1 Plasterer, 1 Painter');
    expect(shortTodayLine(gaps)).toBe('Short today: 1 Carpenter, 1 Plasterer, 1 Painter');
    const full = teamGaps([{ role: 'Cleaner', count: 2 }], [m('Cleaner'), m('Cleaner'), m('Cleaner')]);
    expect(shortLine(full)).toBeNull();
    expect(shortTodayLine(full)).toBeNull();
    expect(makeUpLine(makeUp)).toBe('2 Carpenter · 2 Plasterer · 1 Painter');
    expect(makeUpLine([])).toBeNull();
  });

  it('sorts people by the make-up, then other roles, then name', () => {
    const makeUp = [{ role: 'Plasterer', count: 1 }, { role: 'Carpenter', count: 1 }];
    const list = sortMembers([{ role: 'Cleaner', name: 'Zed' }, { role: 'Carpenter', name: 'Bo' }, { role: 'Plasterer', name: 'Cy' }, { role: 'Carpenter', name: 'Al' }], makeUp);
    expect(list.map(x => `${x.role}:${x.name}`)).toEqual(['Plasterer:Cy', 'Carpenter:Al', 'Carpenter:Bo', 'Cleaner:Zed']);
  });

  it('works out dates for joining and leaving', () => {
    expect(memberState('2026-11-01', null, '2026-11-05')).toBe('current');
    expect(memberState('2026-11-06', null, '2026-11-05')).toBe('upcoming');
    expect(memberState('2026-11-01', '2026-11-04', '2026-11-05')).toBe('ended');
    expect(leaving('2026-11-01', '2026-11-05', null, '2026-11-04')).toEqual({ endsOn: '2026-11-04' });
    expect(leaving('2026-11-05', '2026-11-05', null, '2026-11-04')).toEqual({ remove: true });
    expect(leaving('2026-11-01', '2026-11-05', '2026-11-30', '2026-11-04')).toEqual({ endsOn: '2026-11-30' });
    expect(leaving('2026-11-03', '2026-11-05', '2026-11-01', '2026-11-04')).toHaveProperty('problem');
  });
});

describe('standing teams: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());

  beforeAll(async () => {
    db = await createTestDatabase('crop_teams');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('build','Example Builders'),('nosy','Nosy Co') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'sup@x.com','supervisor'),($1,'w@x.com','worker'),($2,'nosy@x.com','owner')`, [ids.build, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['sup', 'sup@x.com'], ['worker', 'w@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    for (const who of ['admin', 'alloc', 'sup', 'worker', 'nosy']) await http().get('/me').set(as(who)).expect(200);
    for (const [k, first, roles] of [['ana', 'Ana', ['Carpenter']], ['ben', 'Ben', ['Carpenter', 'Painter']], ['cy', 'Cy', ['Plasterer']], ['dee', 'Dee', ['Cleaner']]] as const) {
      ids[k] = (await http().post('/workers').set(as('admin')).send({ firstName: first, lastName: 'Example', roles }).expect(201)).body.id;
    }
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('keeps a team with a make-up and named people, and shows the gaps', async () => {
    const team = (await http().post('/teams').set(as('alloc')).send({
      name: 'Demolition and make good', description: 'Strip-outs', roles: [{ role: 'Carpenter', count: 2 }, { role: 'Plasterer', count: 1 }, { role: 'Painter', count: 1 }],
    }).expect(201)).body;
    ids.demo = team.id;
    expect(team).toMatchObject({ name: 'Demolition and make good', active: true, makeUpLine: '2 Carpenter · 1 Plasterer · 1 Painter', needed: 4, shortLine: 'Short: 2 Carpenter, 1 Plasterer, 1 Painter' });
    await http().post('/teams').set(as('alloc')).send({ name: ' demolition AND make good ' }).expect(409);
    await http().post('/teams').set(as('alloc')).send({ name: 'Bad', roles: [{ role: 'Welder', count: 1 }] }).expect(400);

    await http().post(`/teams/${ids.demo}/members`).set(as('alloc')).send({ workerId: ids.ana, role: 'Carpenter' }).expect(201);
    await http().post(`/teams/${ids.demo}/members`).set(as('alloc')).send({ workerId: ids.ben, role: 'Painter' }).expect(201);
    const r = await http().post(`/teams/${ids.demo}/members`).set(as('alloc')).send({ workerId: ids.cy, role: 'Carpenter' }).expect(400);
    expect(r.body.message).toBe("Cy Example doesn't have the role Carpenter. Add it on their page first.");
    await http().post(`/teams/${ids.demo}/members`).set(as('alloc')).send({ workerId: ids.ana, role: 'Carpenter' }).expect(409);
    let t = (await http().post(`/teams/${ids.demo}/members`).set(as('alloc')).send({ workerId: ids.cy, role: 'Plasterer' }).expect(201)).body;
    expect(t.members.map((m: { name: string; role: string }) => `${m.role}:${m.name}`)).toEqual(['Carpenter:Ana Example', 'Plasterer:Cy Example', 'Painter:Ben Example']);
    expect(t.shortLine).toBe('Short: 1 Carpenter');

    // Someone on approved leave today is away, never with the leave kind.
    await owner.query(`insert into leave_records(tenant_id, worker_id, kind, starts_on, ends_on, status) values ($1,$2,'personal',$3,$3,'approved')`, [ids.build, ids.cy, today()]);
    t = (await http().get(`/teams/${ids.demo}`).set(as('alloc')).expect(200)).body;
    expect(t.awayToday).toEqual([{ workerId: ids.cy, name: 'Cy Example', role: 'Plasterer', away: 'on_leave' }]);
    expect(t.shortTodayLine).toBe('Short today: 1 Carpenter, 1 Plasterer');
    expect(JSON.stringify(t)).not.toContain('personal');

    // A person can be in several teams; their page lists standing teams apart from project teams.
    const cleaning = (await http().post('/teams').set(as('admin')).send({ name: 'Cleaning' }).expect(201)).body;
    await http().put(`/teams/${cleaning.id}/roles`).set(as('admin')).send({ roles: [{ role: 'Cleaner', count: 2 }, { role: 'Carpenter', count: 1 }] }).expect(200);
    await http().post(`/teams/${cleaning.id}/members`).set(as('admin')).send({ workerId: ids.ana, role: 'Carpenter' }).expect(201);
    const mine = (await http().get(`/workers/${ids.ana}/standing-teams`).set(as('alloc')).expect(200)).body as { teamName: string; role: string; state: string }[];
    expect(mine.map(x => `${x.teamName}:${x.role}:${x.state}`)).toEqual(['Cleaning:Carpenter:current', 'Demolition and make good:Carpenter:current']);
    expect((await http().get(`/workers/${ids.ana}/teams`).set(as('alloc')).expect(200)).body).toEqual([]);

    // Changing the make-up replaces it as a set.
    t = (await http().put(`/teams/${cleaning.id}/roles`).set(as('admin')).send({ roles: [{ role: 'Cleaner', count: 3 }] }).expect(200)).body;
    expect(t.roles).toEqual([{ role: 'Cleaner', count: 3 }]);
    expect(t.shortLine).toBe('Short: 3 Cleaner');

    const list = (await http().get('/teams').set(as('alloc')).expect(200)).body;
    expect(list.teams.map((x: { name: string }) => x.name)).toEqual(['Cleaning', 'Demolition and make good']);
  });

  it('keeps history when someone leaves, and puts a team away', async () => {
    const t = (await http().get(`/teams/${ids.demo}`).set(as('alloc')).expect(200)).body;
    const ben = t.members.find((m: { workerId: string }) => m.workerId === ids.ben);
    // Joined today, so taking them off removes the entry as a mistake.
    let after = (await http().post(`/team-members/${ben.id}/remove`).set(as('alloc')).send({}).expect(201)).body;
    expect(after.members.some((m: { workerId: string }) => m.workerId === ids.ben)).toBe(false);
    expect(after.earlier).toEqual([]);
    // Someone who joined earlier leaves with a last day and stays on file.
    await owner.query(`update team_members set starts_on = starts_on - 30 where worker_id = $1`, [ids.ana]);
    const ana = after.members.find((m: { workerId: string }) => m.workerId === ids.ana);
    after = (await http().post(`/team-members/${ana.id}/remove`).set(as('alloc')).send({ reason: 'Moved to Build' }).expect(201)).body;
    expect(after.earlier).toMatchObject([{ workerId: ids.ana, state: 'ended', endReason: 'Moved to Build' }]);
    expect(after.shortLine).toBe('Short: 2 Carpenter, 1 Painter');
    await http().post(`/team-members/${ana.id}/remove`).set(as('alloc')).send({}).expect(404);
    // Joining again later is a new entry.
    await http().post(`/teams/${ids.demo}/members`).set(as('alloc')).send({ workerId: ids.ana, role: 'Carpenter' }).expect(201);

    // The database keeps content as it was: crop_app can't edit a member's role or delete a team.
    const pool = new Pool({ connectionString: db.appUrl });
    await expect(withTenant(pool, ids.build, c => c.query(`update team_members set role = 'Painter'`))).rejects.toThrow(/permission denied/);
    await expect(withTenant(pool, ids.build, c => c.query('delete from teams'))).rejects.toThrow(/permission denied/);
    await pool.end();

    const put = (await http().patch(`/teams/${ids.demo}`).set(as('admin')).send({ active: false }).expect(200)).body;
    expect(put.active).toBe(false);
    await http().post(`/teams/${ids.demo}/members`).set(as('alloc')).send({ workerId: ids.cy, role: 'Plasterer' }).expect(409);
    expect((await http().get('/teams').set(as('alloc')).expect(200)).body.teams.map((x: { name: string }) => x.name)).toEqual(['Cleaning']);
    expect((await http().get('/teams?status=archived').set(as('alloc')).expect(200)).body.teams.map((x: { name: string }) => x.name)).toEqual(['Demolition and make good']);
    // A new team can take the name of one put away; bringing the old one back then clashes.
    await http().post('/teams').set(as('alloc')).send({ name: 'Demolition and make good' }).expect(201);
    await http().patch(`/teams/${ids.demo}`).set(as('admin')).send({ active: true }).expect(409);

    const audit = (await owner.query<{ table_name: string }>(`select distinct table_name from audit_log where table_name like 'team%' order by 1`)).rows.map(r => r.table_name);
    expect(audit).toEqual(['team_members', 'team_roles', 'teams']);
  });

  it('keeps teams to the office and to the business', async () => {
    await http().get('/teams').set(as('worker')).expect(403);
    await http().get('/teams').set(as('sup')).expect(403);
    await http().post('/teams').set(as('sup')).send({ name: 'Mine' }).expect(403);
    expect((await http().get('/teams').set(as('nosy')).expect(200)).body.teams).toEqual([]);
    await http().get(`/teams/${ids.demo}`).set(as('nosy')).expect(404);
    await http().post(`/teams/${ids.demo}/members`).set(as('nosy')).send({ workerId: ids.cy, role: 'Plasterer' }).expect(404);
    const pool = new Pool({ connectionString: db.appUrl });
    for (const table of ['teams', 'team_roles', 'team_members']) {
      expect((await withTenant(pool, ids.nosy, c => c.query(`select 1 from ${table}`))).rowCount).toBe(0);
      expect((await withTenant(pool, ids.build, c => c.query(`select 1 from ${table}`))).rowCount).toBeGreaterThan(0);
    }
    await pool.end();
  });
});
