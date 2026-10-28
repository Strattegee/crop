import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { notReadyMessage, stepProgress, stepsFromRequirements, summarise, type OnboardingFacts, type Step } from '../src/workforce/onboarding.js';
import { startFakeIdp } from './fake-idp.js';

describe('onboarding: rules', () => {
  const base: OnboardingFacts = { ticks: new Map(), credentials: [], rightToWork: null, hasEmployment: false, today: '2026-11-10', windowDays: 30 };
  const step = (kind: Step['kind'], extra: Partial<Step> = {}): Step => ({ id: 's', title: 'Step', help: null, kind, credentialTypeId: null, required: true, ...extra });

  it('a task is done when its latest tick is done', () => {
    expect(stepProgress(step('task'), base).state).toBe('to_do');
    const ticks = new Map([['s', { done: true, at: 'x', byName: 'Pat', note: null }]]);
    expect(stepProgress(step('task'), { ...base, ticks })).toEqual({ state: 'done', detail: 'Ticked by Pat' });
    expect(stepProgress(step('task'), { ...base, ticks: new Map([['s', { done: false, at: 'y', byName: 'Pat', note: null }]]) }).state).toBe('to_do');
  });

  it('a credential step needs a verified credential that has not run out', () => {
    const s = step('credential', { credentialTypeId: 'wwc' });
    const c = (verification: 'verified' | 'unverified' | 'rejected', expiryDate: string | null) => ({ id: 'c', credentialTypeId: 'wwc', expiryDate, verification });
    expect(stepProgress(s, base)).toEqual({ state: 'to_do', detail: 'Not recorded yet' });
    expect(stepProgress(s, { ...base, credentials: [c('unverified', '2030-01-01')] }).state).toBe('waiting');
    expect(stepProgress(s, { ...base, credentials: [c('verified', '2030-01-01')] }).state).toBe('done');
    // Expiring soon still counts; run out does not.
    expect(stepProgress(s, { ...base, credentials: [c('verified', '2026-11-20')] }).state).toBe('done');
    expect(stepProgress(s, { ...base, credentials: [c('verified', '2026-11-09')] })).toEqual({ state: 'to_do', detail: 'Has run out: record the new one' });
    expect(stepProgress(s, { ...base, credentials: [c('rejected', null)] })).toEqual({ state: 'to_do', detail: 'Rejected: record it again' });
    // Another type doesn't count.
    expect(stepProgress(s, { ...base, credentials: [{ ...c('verified', null), credentialTypeId: 'rsa' }] }).state).toBe('to_do');
  });

  it('right to work uses the rostering rule; employment needs terms', () => {
    const rtw = { id: 'r', status: 'citizen' as const, verification: 'unverified' as const, visaExpiry: null, vevoConfirmed: false };
    expect(stepProgress(step('right_to_work'), base).detail).toBe('Not recorded yet');
    expect(stepProgress(step('right_to_work'), { ...base, rightToWork: rtw }).state).toBe('waiting');
    expect(stepProgress(step('right_to_work'), { ...base, rightToWork: { ...rtw, verification: 'verified' } }).state).toBe('done');
    expect(stepProgress(step('right_to_work'), { ...base, rightToWork: { ...rtw, status: 'visa_holder', verification: 'verified', visaExpiry: '2030-01-01' } }).detail)
      .toBe('VEVO check needed confirming work rights');
    expect(stepProgress(step('employment'), { ...base, hasEmployment: true }).state).toBe('done');
  });

  it('only required steps hold up finishing', () => {
    const steps = [step('task', { id: 'a', title: 'Contract signed' }), step('task', { id: 'b', title: 'Uniform', required: false }), step('employment', { id: 'c', title: 'Employment terms set' })];
    const s = summarise(steps, [{ state: 'done', detail: '' }, { state: 'to_do', detail: '' }, { state: 'waiting', detail: '' }]);
    expect(s).toEqual({ done: 1, total: 2, ready: false, outstanding: ['Employment terms set'] });
    expect(notReadyMessage(s)).toBe("Onboarding isn't finished: still to do Employment terms set");
    expect(notReadyMessage({ ...s, outstanding: ['a', 'b', 'c', 'd', 'e'] })).toBe("Onboarding isn't finished: still to do a, b, c and 2 more");
  });

  it('a starting checklist from the rules: checks first, must-haves required, should-haves not', () => {
    const steps = stepsFromRequirements([
      { credentialTypeId: 'wwc', typeName: 'Working with children', scope: 'all_workers', role: null, severity: 'hard' },
      { credentialTypeId: 'fa', typeName: 'First aid', scope: 'all_workers', role: null, severity: 'warning' },
      { credentialTypeId: 'rsa', typeName: 'RSA', scope: 'role', role: 'Bartender', severity: 'hard' },
      { credentialTypeId: 'fa', typeName: 'First aid', scope: 'role', role: 'Bartender', severity: 'hard' },
    ], ['Waiter']);
    expect(steps.map(s => [s.kind, s.title, s.required])).toEqual([
      ['right_to_work', 'Right to work recorded and checked', true], ['employment', 'Employment terms set', true],
      ['credential', 'Working with children', true], ['credential', 'First aid', false],
    ]);
    expect(stepsFromRequirements([
      { credentialTypeId: 'rsa', typeName: 'RSA', scope: 'role', role: 'Bartender', severity: 'hard' },
      { credentialTypeId: 'fa', typeName: 'First aid', scope: 'all_workers', role: null, severity: 'warning' },
      { credentialTypeId: 'fa', typeName: 'First aid', scope: 'role', role: 'Bartender', severity: 'hard' },
    ], ['Bartender']).slice(2).map(s => [s.title, s.required])).toEqual([['First aid', true], ['RSA', true]]);
  });
});

describe('onboarding: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let tenantId: string, otherId: string;
  let wwc: string, rsa: string;
  let checklist: { id: string; steps: { id: string; kind: string; title: string; required: boolean }[] };

  beforeAll(async () => {
    db = await createTestDatabase('crop_onboarding');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    tenantId = t.rows.find(r => r.slug === 'cafe')!.id;
    otherId = t.rows.find(r => r.slug === 'other')!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [tenantId, otherId]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: sub === 'admin' ? 'Pat Admin' : undefined });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    wwc = (await http().post('/credential-types').set(as('admin')).send({ name: 'Working with children', category: 'check', hasNumber: false, needsEvidence: false }).expect(201)).body.id;
    rsa = (await http().post('/credential-types').set(as('admin')).send({ name: 'RSA', category: 'licence', hasNumber: false, needsEvidence: false }).expect(201)).body.id;
    await http().post('/credential-requirements').set(as('admin')).send({ credentialTypeId: wwc, scope: 'all_workers', severity: 'hard' }).expect(201);
    await http().post('/credential-requirements').set(as('admin')).send({ credentialTypeId: rsa, scope: 'role', role: 'Bartender', severity: 'hard' }).expect(201);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('owners and admins make checklists, starting from the rules plus their own tasks', async () => {
    await http().post('/onboarding-checklists').set(as('alloc')).send({ name: 'New staff' }).expect(403);
    const res = await http().post('/onboarding-checklists').set(as('admin')).send({
      name: 'New bar staff', fromRequirements: true, roles: ['Bartender'],
      steps: [{ kind: 'task', title: 'Contract signed' }, { kind: 'task', title: 'Uniform issued', required: false }],
    }).expect(201);
    checklist = res.body;
    expect(checklist.steps.map(s => [s.kind, s.title, s.required])).toEqual([
      ['right_to_work', 'Right to work recorded and checked', true], ['employment', 'Employment terms set', true],
      ['credential', 'RSA', true], ['credential', 'Working with children', true],
      ['task', 'Contract signed', true], ['task', 'Uniform issued', false],
    ]);
    await http().post('/onboarding-checklists').set(as('admin')).send({ name: 'new bar staff' }).expect(400);
    const bad = await http().post('/onboarding-checklists').set(as('admin')).send({ name: 'X', steps: [{ kind: 'task' }] }).expect(400);
    expect(bad.body.message).toBe('Step 1: say what needs doing');
    // Other businesses don't see it.
    expect((await http().get('/onboarding-checklists').set(as('other')).expect(200)).body).toEqual([]);
  });

  it('editing keeps steps sent with their id, removes the rest, and adds new ones', async () => {
    const keep = checklist.steps.filter(s => s.title !== 'Uniform issued').map(s => ({ id: s.id, kind: s.kind, title: s.title, required: s.required,
      credentialTypeId: s.kind === 'credential' ? (s.title === 'RSA' ? rsa : wwc) : undefined }));
    const res = await http().patch(`/onboarding-checklists/${checklist.id}`).set(as('admin'))
      .send({ steps: [...keep, { kind: 'task', title: 'Induction done', help: 'Walk through the kitchen and fire exits' }] }).expect(200);
    expect(res.body.steps.map((s: { title: string }) => s.title)).toEqual([
      'Right to work recorded and checked', 'Employment terms set', 'RSA', 'Working with children', 'Contract signed', 'Induction done']);
    expect(res.body.steps[0].id).toBe(checklist.steps[0].id);
    checklist = res.body;
    const wrongKind = await http().patch(`/onboarding-checklists/${checklist.id}`).set(as('admin'))
      .send({ steps: [{ id: checklist.steps[0].id, kind: 'task', title: 'x' }] }).expect(400);
    expect(wrongKind.body.message).toMatch(/can’t change kind/);
  });

  it('adding someone with a checklist keeps them off the roster until onboarding is finished', async () => {
    const w = (await http().post('/workers').set(as('alloc')).send({ firstName: 'Robin', lastName: 'Example', roles: ['Bartender'], onboardingChecklistId: checklist.id }).expect(201)).body;
    expect(w.status).toBe('onboarding');
    // Onboarding people aren't offered shifts: the candidates list only takes active people.
    const list = (await http().get('/workers?status=onboarding').set(as('alloc')).expect(200)).body;
    expect(list.map((x: { id: string }) => x.id)).toEqual([w.id]);

    let o = (await http().get(`/workers/${w.id}/onboarding`).set(as('alloc')).expect(200)).body.current;
    expect(o.summary).toMatchObject({ done: 0, total: 6, ready: false });
    expect(o.startedByName).toBe('alloc@x.com');
    const stepId = (title: string) => o.steps.find((s: { title: string }) => s.title === title).id;

    // Starting again is refused.
    await http().post(`/workers/${w.id}/onboarding`).set(as('alloc')).send({ checklistId: checklist.id }).expect(409);
    // Only task steps can be ticked.
    await http().post(`/onboardings/${o.id}/steps/${stepId('RSA')}/tick`).set(as('alloc')).send({ done: true }).expect(400);
    o = (await http().post(`/onboardings/${o.id}/steps/${stepId('Contract signed')}/tick`).set(as('alloc')).send({ done: true }).expect(200)).body;
    expect(o.steps.find((s: { title: string }) => s.title === 'Contract signed')).toMatchObject({ state: 'done', detail: 'Ticked by alloc@x.com' });

    // Not ready: the message lists what's left.
    const early = await http().post(`/onboardings/${o.id}/finish`).set(as('admin')).send({}).expect(400);
    expect(early.body.message).toBe("Onboarding isn't finished: still to do Right to work recorded and checked, Employment terms set, RSA and 2 more");
    await http().post(`/onboardings/${o.id}/finish`).set(as('alloc')).send({}).expect(403);

    // Records tick their steps themselves.
    await http().put(`/workers/${w.id}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
    o = (await http().get(`/workers/${w.id}/onboarding`).set(as('alloc')).expect(200)).body.current;
    expect(o.steps[0]).toMatchObject({ state: 'waiting', detail: 'Recorded, waiting to be checked' });
    await http().post(`/workers/${w.id}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    await http().post(`/workers/${w.id}/employment`).set(as('admin')).send({ employmentType: 'casual', startsOn: '2026-01-01' }).expect(201);
    for (const type of [rsa, wwc]) {
      const c = (await http().post(`/workers/${w.id}/credentials`).set(as('admin')).send({ credentialTypeId: type, expiryDate: '2030-01-31' }).expect(201)).body.id;
      await http().post(`/workers/${w.id}/credentials/${c}/verify`).set(as('admin')).send({}).expect(201);
    }
    o = (await http().get(`/workers/${w.id}/onboarding`).set(as('alloc')).expect(200)).body.current;
    expect(o.summary).toMatchObject({ done: 5, total: 6, outstanding: ['Induction done'] });
    await http().post(`/onboardings/${o.id}/steps/${stepId('Induction done')}/tick`).set(as('alloc')).send({ done: true, note: 'Done on day one' }).expect(200);

    const done = (await http().post(`/onboardings/${o.id}/finish`).set(as('admin')).send({}).expect(200)).body;
    expect(done).toMatchObject({ outcome: 'completed', finishedByName: 'Pat Admin', activated: true });
    expect((await http().get(`/workers/${w.id}`).set(as('alloc')).expect(200)).body.status).toBe('active');
    await http().post(`/onboardings/${o.id}/steps/${stepId('Induction done')}/tick`).set(as('alloc')).send({ done: false }).expect(409);
    const after = (await http().get(`/workers/${w.id}/onboarding`).set(as('alloc')).expect(200)).body;
    expect(after.current).toBeNull();
    expect(after.history).toMatchObject([{ checklistName: 'New bar staff', outcome: 'completed' }]);
    // Ticks are a log: they can't be changed or removed.
    await expect(owner.query(`set role crop_app; update onboarding_ticks set done = false`)).rejects.toThrow(/permission denied/);
    await owner.query('reset role');
  });

  it('starting onboarding for an existing person can leave them on the roster; stopping it makes a held person inactive', async () => {
    const w = (await http().post('/workers').set(as('alloc')).send({ firstName: 'Sam', lastName: 'Example' }).expect(201)).body;
    const o = (await http().post(`/workers/${w.id}/onboarding`).set(as('alloc')).send({ checklistId: checklist.id, hold: false }).expect(201)).body;
    expect((await http().get(`/workers/${w.id}`).set(as('alloc')).expect(200)).body.status).toBe('active');
    expect((await http().get('/onboardings').set(as('alloc')).expect(200)).body.map((x: { workerName: string }) => x.workerName)).toEqual(['Sam Example']);
    await http().post(`/onboardings/${o.id}/stop`).set(as('admin')).send({}).expect(400);
    await http().post(`/onboardings/${o.id}/stop`).set(as('admin')).send({ reason: 'Took another job' }).expect(200);
    expect((await http().get(`/workers/${w.id}`).set(as('alloc')).expect(200)).body.status).toBe('active');

    const held = (await http().post('/workers').set(as('alloc')).send({ firstName: 'Kim', lastName: 'Example', onboardingChecklistId: checklist.id }).expect(201)).body;
    const ho = (await http().get(`/workers/${held.id}/onboarding`).set(as('alloc')).expect(200)).body.current;
    await http().post(`/onboardings/${ho.id}/stop`).set(as('admin')).send({ reason: 'Did not start' }).expect(200);
    expect((await http().get(`/workers/${held.id}`).set(as('alloc')).expect(200)).body.status).toBe('inactive');
    expect((await http().get('/onboardings').set(as('alloc')).expect(200)).body).toEqual([]);
  });

  it('a checklist put away cannot be started, and its name is free again', async () => {
    await http().patch(`/onboarding-checklists/${checklist.id}`).set(as('admin')).send({ archived: true }).expect(200);
    expect((await http().get('/onboarding-checklists').set(as('alloc')).expect(200)).body).toEqual([]);
    expect((await http().get('/onboarding-checklists?archived=true').set(as('alloc')).expect(200)).body).toHaveLength(1);
    const res = await http().post('/workers').set(as('alloc')).send({ firstName: 'Lee', lastName: 'Example', onboardingChecklistId: checklist.id }).expect(400);
    expect(res.body.message).toBe('That checklist has been put away');
    // Nothing was created when the start was refused.
    expect((await http().get('/workers?search=Lee').set(as('alloc')).expect(200)).body).toEqual([]);
    await http().post('/onboarding-checklists').set(as('admin')).send({ name: 'New bar staff', steps: [{ kind: 'employment' }] }).expect(201);
    await http().patch(`/onboarding-checklists/${checklist.id}`).set(as('admin')).send({ archived: false }).expect(400);
  });

  it('isolation: another business cannot see or change onboarding records', async () => {
    const o = (await owner.query<{ id: string }>('select id from worker_onboardings limit 1')).rows[0].id;
    await http().post(`/onboardings/${o}/stop`).set(as('other')).send({ reason: 'x' }).expect(404);
    await http().patch(`/onboarding-checklists/${checklist.id}`).set(as('other')).send({ name: 'Mine' }).expect(404);
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [otherId]);
      for (const table of ['onboarding_checklists', 'onboarding_steps', 'worker_onboardings', 'onboarding_ticks']) {
        expect((await c.query(`select count(*)::int as n from ${table}`)).rows[0].n).toBe(0);
      }
      await c.query('rollback');
    } finally { await c.end(); }
    expect(tenantId).toBeTruthy();
  });
});
