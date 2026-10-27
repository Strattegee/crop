import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { workerCompliance, type RequirementRule } from '../src/workforce/compliance.js';
import { startFakeIdp } from './fake-idp.js';

describe('shift duties: rules', () => {
  const rsa: RequirementRule = { credentialTypeId: 'rsa', typeName: 'RSA', scope: 'all_workers', role: null, severity: 'hard', forDuty: 'Serves alcohol' };

  it('a duty adds its credential for whoever works the shift, and says which duty', () => {
    const { issues, status } = workerCompliance(['Waiter'], [rsa], [], '2026-11-10', 30);
    expect(status).toBe('non_compliant');
    expect(issues).toEqual([{ credentialTypeId: 'rsa', typeName: 'RSA', severity: 'hard', problem: 'missing', credentialId: null, forDuty: 'Serves alcohol' }]);
  });

  it("names the duty only when the business's own rules don't already ask for it", () => {
    const base: RequirementRule = { credentialTypeId: 'rsa', typeName: 'RSA', scope: 'role', role: 'Bartender', severity: 'hard' };
    expect(workerCompliance(['Bartender'], [base, rsa], [], '2026-11-10', 30).issues[0].forDuty).toBeUndefined();
    // A warning-level business rule is outranked by the duty's hard rule.
    const soft = { ...base, severity: 'warning' as const };
    expect(workerCompliance(['Bartender'], [soft, rsa], [], '2026-11-10', 30).issues[0]).toMatchObject({ severity: 'hard', forDuty: 'Serves alcohol' });
  });
});

describe('shift duties: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let tenantId: string, otherId: string;
  let site: string, rsa: string, food: string;
  let ana: string, ben: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_duties');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    tenantId = t.rows.find(r => r.slug === 'cafe')!.id;
    otherId = t.rows.find(r => r.slug === 'other')!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [tenantId, otherId]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    site = (await http().post('/facilities').set(as('admin')).send({ name: 'Harbour Cafe', state: 'VIC' }).expect(201)).body.id;
    rsa = (await http().post('/credential-types').set(as('admin')).send({ name: 'RSA', category: 'licence', hasNumber: false, needsEvidence: false }).expect(201)).body.id;
    food = (await http().post('/credential-types').set(as('admin')).send({ name: 'Food safety supervisor', category: 'training', hasNumber: false, needsEvidence: false }).expect(201)).body.id;
    const person = async (firstName: string) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Waiter'] }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      return w;
    };
    ana = await person('Ana');
    ben = await person('Ben');
    // Ana's RSA has expired; Ben's is current.
    const addRsa = async (w: string, expiryDate: string) => {
      const c = (await http().post(`/workers/${w}/credentials`).set(as('admin')).send({ credentialTypeId: rsa, expiryDate }).expect(201)).body.id;
      await http().post(`/workers/${w}/credentials/${c}/verify`).set(as('admin')).send({}).expect(201);
    };
    await addRsa(ana, '2026-01-31');
    await addRsa(ben, '2030-01-31');
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  const shift = async (date: string) =>
    (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Waiter', date, startTime: '17:00', endTime: '23:00' }).expect(201)).body.ids[0] as string;

  it('owners and admins keep a list of duties with what each needs', async () => {
    await http().post('/shift-duties').set(as('alloc')).send({ name: 'Serves alcohol' }).expect(403);
    const d = (await http().post('/shift-duties').set(as('admin'))
      .send({ name: 'Serves alcohol', description: 'Bar open', requirements: [{ credentialTypeId: rsa }] }).expect(201)).body;
    expect(d).toMatchObject({ name: 'Serves alcohol', description: 'Bar open', active: true, requirements: [{ credentialTypeId: rsa, typeName: 'RSA', severity: 'hard' }] });
    const dup = await http().post('/shift-duties').set(as('admin')).send({ name: 'serves ALCOHOL' }).expect(400);
    expect(dup.body.message).toBe('There is already a duty called serves ALCOHOL');
    await http().post('/shift-duties').set(as('admin')).send({ name: 'Bad', requirements: [{ credentialTypeId: rsa, severity: 'maybe' }] }).expect(400);

    const sup = (await http().post('/shift-duties').set(as('admin')).send({ name: 'Food safety supervisor on site' }).expect(201)).body;
    const changed = (await http().patch(`/shift-duties/${sup.id}`).set(as('admin'))
      .send({ requirements: [{ credentialTypeId: food, severity: 'warning' }], description: null }).expect(200)).body;
    expect(changed.requirements).toEqual([{ credentialTypeId: food, typeName: 'Food safety supervisor', severity: 'warning' }]);

    const list = (await http().get('/shift-duties').set(as('alloc')).expect(200)).body;
    expect(list.map((x: { name: string }) => x.name)).toEqual(['Food safety supervisor on site', 'Serves alcohol']);
    // Another business sees none of them.
    expect((await http().get('/shift-duties').set(as('other')).expect(200)).body).toEqual([]);
  });

  it("a duty's rules apply to whoever works the shift, and only when the shift has the duty", async () => {
    const [alcohol, sup] = await (async () => {
      const list = (await http().get('/shift-duties').set(as('alloc')).expect(200)).body as { id: string; name: string }[];
      return [list.find(d => d.name === 'Serves alcohol')!.id, list.find(d => d.name.startsWith('Food'))!.id];
    })();
    const s = await shift('2026-11-10');
    // No duty: Ana can work it, expired RSA or not.
    let c = (await http().get(`/shifts/${s}/candidates`).set(as('alloc')).expect(200)).body.candidates;
    expect(c.find((x: { workerId: string }) => x.workerId === ana).eligible).toBe(true);

    const set = (await http().put(`/shifts/${s}/duties`).set(as('alloc')).send({ dutyIds: [alcohol, sup] }).expect(200)).body;
    expect(set.duties.map((d: { name: string }) => d.name)).toEqual(['Food safety supervisor on site', 'Serves alcohol']);
    expect(set.personProblems).toEqual([]);

    c = (await http().get(`/shifts/${s}/candidates`).set(as('alloc')).expect(200)).body.candidates;
    const a = c.find((x: { workerId: string }) => x.workerId === ana);
    const b = c.find((x: { workerId: string }) => x.workerId === ben);
    expect(a.eligible).toBe(false);
    expect(a.blocks.map((r: { message: string }) => r.message)).toContain('Ana Example\'s RSA will have expired by the shift date (needed for Serves alcohol)');
    expect(b.eligible).toBe(true);
    expect(b.warnings.map((r: { message: string }) => r.message)).toContain("Ben Example's Food safety supervisor is missing (needed for Food safety supervisor on site)");
    const refused = await http().post(`/shifts/${s}/assign`).set(as('alloc')).send({ workerId: ana }).expect(409);
    expect(refused.body.message).toMatch(/RSA/);

    // Ana is booked on a shift without the duty; adding it later says she no longer meets it.
    const t = await shift('2026-11-11');
    await http().post(`/shifts/${t}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    const later = (await http().put(`/shifts/${t}/duties`).set(as('alloc')).send({ dutyIds: [alcohol] }).expect(200)).body;
    expect(later.personProblems).toEqual(["Ana Example's RSA will have expired by the shift date (needed for Serves alcohol)"]);
    // Taking the duty off again clears it.
    expect((await http().put(`/shifts/${t}/duties`).set(as('alloc')).send({ dutyIds: [] }).expect(200)).body).toMatchObject({ duties: [], personProblems: [] });

    // Every change is in the shift's history.
    const history = (await http().get(`/shifts/${t}/history`).set(as('alloc')).expect(200)).body.map((h: { summary: string }) => h.summary);
    expect(history).toEqual(expect.arrayContaining(['Duty added: Serves alcohol', 'Duty removed: Serves alcohol']));

    // A switched-off duty can't be added and no longer counts on shifts that have it.
    await http().patch(`/shift-duties/${alcohol}`).set(as('admin')).send({ active: false }).expect(200);
    await http().put(`/shifts/${t}/duties`).set(as('alloc')).send({ dutyIds: [alcohol] }).expect(400);
    c = (await http().get(`/shifts/${s}/candidates`).set(as('alloc')).expect(200)).body.candidates;
    expect(c.find((x: { workerId: string }) => x.workerId === ana).eligible).toBe(true);
    await http().patch(`/shift-duties/${alcohol}`).set(as('admin')).send({ active: true }).expect(200);

    // Bad input.
    await http().put(`/shifts/${s}/duties`).set(as('alloc')).send({ dutyIds: 'all' }).expect(400);
    await http().put(`/shifts/${s}/duties`).set(as('other')).send({ dutyIds: [] }).expect(404);
  });

  it('follows the after-publishing rule like any other shift change', async () => {
    const list = (await http().get('/shift-duties').set(as('alloc')).expect(200)).body as { id: string; name: string }[];
    const alcohol = list.find(d => d.name === 'Serves alcohol')!.id;
    const s = await shift('2026-11-17');
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: '2026-11-16', facilityId: site, notify: false }).expect(201);
    await http().patch('/settings').set(as('admin')).send({ publishedChanges: 'managers' }).expect(200);
    const refused = await http().put(`/shifts/${s}/duties`).set(as('alloc')).send({ dutyIds: [alcohol] }).expect(409);
    expect(refused.body.message).toMatch(/only an owner or admin/);
    await http().put(`/shifts/${s}/duties`).set(as('admin')).send({ dutyIds: [alcohol] }).expect(200);
    await http().patch('/settings').set(as('admin')).send({ publishedChanges: 'open' }).expect(200);
  });

  it('duties can be chosen when adding shifts, for every shift in a block', async () => {
    const list = (await http().get('/shift-duties').set(as('alloc')).expect(200)).body as { id: string; name: string }[];
    const alcohol = list.find(d => d.name === 'Serves alcohol')!.id;
    const sup = list.find(d => d.name.startsWith('Food'))!.id;
    const made = (await http().post('/shifts').set(as('alloc')).send({
      facilityId: site, role: 'Waiter', startDate: '2026-12-14', endDate: '2026-12-15', startTime: '17:00', endTime: '23:00',
      quantity: 2, dutyIds: [alcohol, sup, alcohol],
    }).expect(201)).body;
    expect(made.created).toBe(4);
    const shifts = (await http().get('/shifts?from=2026-12-14&to=2026-12-15').set(as('alloc')).expect(200)).body as { id: string; duties: { name: string }[] }[];
    const ours = shifts.filter(x => made.ids.includes(x.id));
    expect(ours).toHaveLength(4);
    for (const x of ours) expect(x.duties.map(d => d.name)).toEqual(['Food safety supervisor on site', 'Serves alcohol']);
    // Ana's RSA has run out, so she can't be put on them.
    await http().post(`/shifts/${made.ids[0]}/assign`).set(as('alloc')).send({ workerId: ana }).expect(409);
    const history = (await http().get(`/shifts/${made.ids[0]}/history`).set(as('alloc')).expect(200)).body.map((h: { summary: string }) => h.summary);
    expect(history).toEqual(expect.arrayContaining(['Duty added: Serves alcohol']));

    // A switched-off duty refuses the whole request; nothing is created.
    await http().patch(`/shift-duties/${sup}`).set(as('admin')).send({ active: false }).expect(200);
    const bad = await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Waiter', date: '2026-12-16', startTime: '17:00', endTime: '23:00', dutyIds: [sup] }).expect(400);
    expect(bad.body.message).toBe('One of those duties is switched off or no longer exists');
    expect((await http().get('/shifts?from=2026-12-16&to=2026-12-16').set(as('alloc')).expect(200)).body).toEqual([]);
    await http().patch(`/shift-duties/${sup}`).set(as('admin')).send({ active: true }).expect(200);
    await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Waiter', date: '2026-12-16', startTime: '17:00', endTime: '23:00', dutyIds: 'bar' }).expect(400);
  });

  it('copied weeks and templates keep the duties, and the usual person must still meet them', async () => {
    const list = (await http().get('/shift-duties').set(as('alloc')).expect(200)).body as { id: string; name: string }[];
    const alcohol = list.find(d => d.name === 'Serves alcohol')!.id;
    const s = await shift('2026-11-24');
    await http().post(`/shifts/${s}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    await http().put(`/shifts/${s}/duties`).set(as('alloc')).send({ dutyIds: [alcohol] }).expect(200);

    const copy = (await http().post('/roster/copy-week').set(as('alloc')).send({ facilityId: site, fromWeek: '2026-11-23', toWeek: '2026-11-30' }).expect(200)).body;
    expect(copy).toMatchObject({ created: 1, assigned: 0 });
    expect(copy.leftOpen[0].reason).toMatch(/RSA/);
    const copied = (await http().get('/roster?from=2026-11-30&to=2026-12-06').set(as('alloc')).expect(200)).body.shifts;
    expect(copied.map((x: { duties: { name: string }[] }) => x.duties.map(d => d.name))).toEqual([['Serves alcohol']]);

    const tpl = (await http().post('/roster/templates').set(as('alloc')).send({ facilityId: site, weekStart: '2026-11-23', name: 'Bar week' }).expect(201)).body;
    await http().post(`/roster/templates/${tpl.id}/apply`).set(as('alloc')).send({ weekStart: '2026-12-07' }).expect(200);
    const applied = (await http().get('/roster?from=2026-12-07&to=2026-12-13').set(as('alloc')).expect(200)).body.shifts;
    expect(applied[0]).toMatchObject({ status: 'open', duties: [{ id: alcohol, name: 'Serves alcohol' }] });
  });

  it("keeps each business's duties to itself", async () => {
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [otherId]);
      for (const table of ['shift_duties', 'shift_duty_requirements', 'shift_duty_links', 'roster_template_duties']) {
        expect((await c.query(`select count(*)::int as n from ${table}`)).rows[0].n).toBe(0);
      }
      await c.query('rollback');
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      expect((await c.query('select count(*)::int as n from shift_duties')).rows[0].n).toBe(2);
      await expect(c.query('delete from shift_duties')).rejects.toThrow(/permission denied/);
      await c.query('rollback');
    } finally {
      await c.end();
    }
  });
});
