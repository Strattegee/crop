import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { addDays, todayIn } from '../src/workforce/compliance.js';
import { daysSince, moveRefusal } from '../src/workforce/recruitment.js';
import { startFakeIdp } from './fake-idp.js';

describe('recruitment board rules (David, 31 Oct)', () => {
  it('moves applicants only; onboarding people move by finishing or stopping', () => {
    expect(moveRefusal({ status: 'applicant', stage: 'applied', lastEvent: 'applied' }, 'screening')).toBeNull();
    expect(moveRefusal({ status: 'applicant', stage: 'screening', lastEvent: 'screening' }, 'applied')).toBeNull();
    expect(moveRefusal({ status: 'applicant', stage: 'offer', lastEvent: 'offer' }, 'offer')).toBe('They are already at Offer');
    expect(moveRefusal({ status: 'onboarding', stage: null, lastEvent: 'onboarding' }, 'offer')).toMatch(/being onboarded/);
    expect(moveRefusal({ status: 'active', stage: null, lastEvent: null }, 'screening')).toBe('Only applicants move on the recruitment board');
    expect(moveRefusal({ status: 'inactive', stage: 'interview', lastEvent: 'not_proceeding' }, 'reopen')).toBeNull();
    expect(moveRefusal({ status: 'inactive', stage: null, lastEvent: null }, 'reopen')).toMatch(/Only someone marked/);
  });
  it('counts whole days', () => {
    expect(daysSince('2026-10-28T10:00:00Z', new Date('2026-10-31T09:00:00Z'))).toBe(2);
    expect(daysSince(null)).toBeNull();
  });
});

describe('recruitment board end to end', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let ana: string, ben: string, checklist: string, site: string;
  const board = async () => (await http().get('/recruitment').set(as('alloc')).expect(200)).body as
    { columns: Array<{ stage: string; people: Array<{ id: string; progress?: { done: number; total: number } }> }>; notProceeding: number };
  const where = (b: Awaited<ReturnType<typeof board>>, id: string) => b.columns.find(c => c.people.some(p => p.id === id))?.stage ?? null;

  beforeAll(async () => {
    db = await createTestDatabase('crop_recruitment');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('care','Demo Care'),('other','Other') returning id`);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`,
      [t.rows[0].id, t.rows[1].id]);
    await owner.end();
    for (const [sub, email] of [['owner', 'owner@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    site = (await http().post('/facilities').set(as('owner')).send({ name: 'Bayside House', state: 'VIC' }).expect(201)).body.id;
    checklist = (await http().post('/onboarding-checklists').set(as('owner'))
      .send({ name: 'New carers', steps: [{ kind: 'task', title: 'Contract signed', required: true }] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('adds applicants to Applied, kept off the roster', async () => {
    await http().post('/workers').set(as('alloc')).send({ firstName: 'X', lastName: 'Y', applicant: true, onboardingChecklistId: checklist }).expect(400);
    const a = (await http().post('/workers').set(as('alloc')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Carer'], applicant: true }).expect(201)).body;
    expect(a).toMatchObject({ status: 'applicant', recruitmentStage: 'applied' });
    ana = a.id;
    ben = (await http().post('/workers').set(as('alloc')).send({ firstName: 'Ben', lastName: 'Example', roles: ['Carer'], applicant: true }).expect(201)).body.id;
    expect(where(await board(), ana)).toBe('applied');
    const [shift] = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Carer', date: addDays(todayIn('Australia/Melbourne'), 7), startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids;
    const cands = (await http().get(`/shifts/${shift}/candidates`).set(as('alloc')).expect(200)).body.candidates as Array<{ workerId: string }>;
    expect(cands.some(c => c.workerId === ana)).toBe(false);
  });

  it('moves through the stages and logs each move', async () => {
    for (const stage of ['screening', 'interview', 'offer']) await http().post(`/workers/${ana}/stage`).set(as('alloc')).send({ stage }).expect(200);
    expect(where(await board(), ana)).toBe('offer');
    await http().post(`/workers/${ana}/stage`).set(as('alloc')).send({ stage: 'offer' }).expect(409);
    await http().post(`/workers/${ana}/stage`).set(as('alloc')).send({ stage: 'hired' }).expect(400);
    await http().post(`/workers/${ana}/stage`).set(as('worker')).send({ stage: 'applied' }).expect(403);
    const h = (await http().get(`/workers/${ana}/recruitment`).set(as('alloc')).expect(200)).body as Array<{ toStage: string; fromStage: string | null }>;
    expect(h.map(e => e.toStage)).toEqual(['applied', 'screening', 'interview', 'offer']);
    expect(h[3].fromStage).toBe('interview');
  });

  it('not proceeding takes them off the board; reopening brings them back', async () => {
    await http().post(`/workers/${ben}/stage`).set(as('alloc')).send({ stage: 'not_proceeding', note: 'Took another job' }).expect(200);
    let b = await board();
    expect(where(b, ben)).toBeNull();
    expect(b.notProceeding).toBe(1);
    const np = (await http().get('/recruitment/not-proceeding').set(as('alloc')).expect(200)).body;
    expect(np[0]).toMatchObject({ id: ben, note: 'Took another job' });
    await http().post(`/workers/${ben}/stage`).set(as('alloc')).send({ stage: 'reopen' }).expect(200);
    b = await board();
    expect(where(b, ben)).toBe('applied');
  });

  it('starting onboarding moves them to Onboarding; finishing to Started', async () => {
    await http().post(`/workers/${ana}/onboarding`).set(as('alloc')).send({ checklistId: checklist }).expect(201);
    let b = await board();
    expect(where(b, ana)).toBe('onboarding');
    const col = b.columns.find(c => c.stage === 'onboarding')!;
    expect(col.people[0].progress).toMatchObject({ done: 0, total: 1 });
    await http().post(`/workers/${ana}/stage`).set(as('alloc')).send({ stage: 'offer' }).expect(409);
    const o = (await http().get(`/workers/${ana}/onboarding`).set(as('alloc')).expect(200)).body.current;
    await http().post(`/onboardings/${o.id}/steps/${o.steps[0].id}/tick`).set(as('alloc')).send({ done: true }).expect(200);
    await http().put(`/workers/${ana}/right-to-work`).set(as('owner')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
    await http().post(`/onboardings/${o.id}/finish`).set(as('owner')).send({}).expect(200);
    b = await board();
    expect(where(b, ana)).toBe('started');
    const h = (await http().get(`/workers/${ana}/recruitment`).set(as('alloc')).expect(200)).body as Array<{ toStage: string }>;
    expect(h.map(e => e.toStage).slice(-2)).toEqual(['onboarding', 'started']);
  });

  it("another business sees none of it", async () => {
    const b = (await http().get('/recruitment').set(as('other')).expect(200)).body;
    expect(b.columns.every((c: { people: unknown[] }) => c.people.length === 0)).toBe(true);
    await http().post(`/workers/${ben}/stage`).set(as('other')).send({ stage: 'screening' }).expect(404);
  });
});
