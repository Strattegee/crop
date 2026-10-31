import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { DOCUMENT_STORE, MemoryStore } from '../src/documents/document-store.js';
import {
  myAddRefusal, myCheckState, myCredentialDatesRefusal, myEvidenceRefusal, myNeedAddable, myNeedLine, myOnboardingLine, myStep,
} from '../src/worker-app/worker-app.js';
import { startFakeIdp } from './fake-idp.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe('my credentials: pure rules', () => {
  it('words what the person needs to do', () => {
    expect(myCheckState('verified')).toBe('checked');
    expect(myCheckState('unverified')).toBe('to_check');
    expect(myCheckState('rejected')).toBe('not_accepted');
    const i = (problem: string, credentialTypeId = 'x') => ({ typeName: 'First aid', problem, credentialTypeId });
    expect(myNeedLine(i('missing'))).toBe('Add your First aid');
    expect(myNeedLine(i('expired'))).toBe('Your First aid has run out: add the new one');
    expect(myNeedLine(i('expiring'))).toBe('Your First aid runs out soon: add the new one when you have it');
    expect(myNeedLine(i('unverified'))).toBe('First aid: waiting for the office to check it');
    expect(myNeedLine(i('rejected'))).toBe("Your First aid wasn't accepted: add it again or contact the office");
    expect(myNeedLine({ typeName: 'Right to work', problem: 'missing', credentialTypeId: 'right-to-work' })).toBe('Right to work: please contact the office');
    expect(myNeedLine({ typeName: 'Right to work', problem: 'unverified', credentialTypeId: 'right-to-work' })).toBe('Right to work: the office is checking it');
    expect(myNeedAddable(i('missing'))).toBe(true);
    expect(myNeedAddable(i('unverified'))).toBe(false);
    expect(myNeedAddable({ problem: 'missing', credentialTypeId: 'right-to-work' })).toBe(false);
  });

  it('refuses what the app should not do', () => {
    expect(myAddRefusal({ typeName: 'First aid', waiting: true })).toMatch(/^You've already added a First aid/);
    expect(myAddRefusal({ typeName: 'First aid', waiting: false })).toBeNull();
    expect(myCredentialDatesRefusal('2026-11-03', null, '2026-11-02')).toBe('The issue date is in the future');
    expect(myCredentialDatesRefusal(null, '2026-11-01', '2026-11-02')).toBe('This has already run out. Add it once you have the new one.');
    expect(myCredentialDatesRefusal('2026-11-02', '2026-11-02', '2026-11-02')).toBeNull();
    expect(myEvidenceRefusal('verified', 0)).toMatch(/already checked/);
    expect(myEvidenceRefusal('rejected', 0)).toMatch(/wasn't accepted/);
    expect(myEvidenceRefusal('unverified', 10)).toBe('You can add up to 10 files to one credential');
    expect(myEvidenceRefusal('unverified', 9)).toBeNull();
  });
  it('words onboarding steps for the person themselves', () => {
    const s = (kind: 'task' | 'credential' | 'right_to_work' | 'employment', state: 'done' | 'waiting' | 'to_do', detail = 'Not recorded yet') =>
      myStep({ id: 'x', title: 'T', kind, required: true, credentialTypeId: kind === 'credential' ? 'c' : null, state, detail }, 'Tickets');
    expect(s('task', 'done', 'Ticked by Sam')).toMatchObject({ line: 'Done', yours: false });
    expect(s('task', 'to_do').line).toBe('The office will tick this off');
    expect(s('employment', 'to_do').line).toBe('The office will set up your employment');
    expect(s('right_to_work', 'to_do').line).toBe('Please contact the office about your right to work');
    expect(s('right_to_work', 'waiting').line).toBe('Sent: the office is checking it');
    expect(s('credential', 'done').line).toBe('Checked');
    expect(s('credential', 'waiting')).toMatchObject({ line: 'Sent: waiting for the office to check it', yours: false });
    expect(s('credential', 'to_do')).toMatchObject({ line: 'Add it in Tickets', yours: true, need: 'missing' });
    expect(s('credential', 'to_do', 'Has run out: record the new one')).toMatchObject({ line: 'Yours has run out: add the new one in Tickets', need: 'expired' });
    expect(s('credential', 'to_do', 'Rejected: record it again')).toMatchObject({ line: 'Not accepted: add it again in Tickets', need: 'rejected' });
    expect(myOnboardingLine(2, 5)).toBe('2 of 5 done');
    expect(myOnboardingLine(5, 5)).toBe('All done: the office will let you know when you can start');
  });
});

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('my credentials in the worker app', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const store = new MemoryStore();
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let ana: string, ben: string, firstAid: string, foodSafety: string, barista: string, otherType: string;
  let today: string;
  const signIn = async (sub: string, email: string) => {
    idp.addUser({ sub, email, email_verified: true, name: sub });
    tok[sub] = await idp.token(sub, { expiresIn: '1h' });
  };

  beforeAll(async () => {
    db = await createTestDatabase('crop_my_credentials');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($2,'o@x.com','owner')`, [id('cafe'), id('other')]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['other', 'o@x.com']]) await signIn(sub, email);
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DOCUMENT_STORE).useValue(store).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    const type = async (tenant: string, name: string, hasNumber: boolean, hasExpiry: boolean) =>
      (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category, has_number, has_expiry) values ($1,$2,'training',$3,$4) returning id`,
        [id(tenant), name, hasNumber, hasExpiry])).rows[0].id;
    firstAid = await type('cafe', 'First aid', false, true);
    foodSafety = await type('cafe', 'Food safety', false, false);
    barista = await type('cafe', 'Barista course', false, false);
    otherType = await type('other', 'Elsewhere', false, false);
    await owner.query(`insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity)
      values ($1,$2,'role','Chef','hard'), ($1,$3,'all_workers',null,'warning'), ($1,$4,'role','Chef','optional')`, [id('cafe'), firstAid, foodSafety, barista]);

    const person = async (firstName: string, email: string) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Chef'], email }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      await http().post(`/workers/${w}/app-access`).set(as('admin')).expect(201);
      return w;
    };
    ana = await person('Ana', 'ana@example.com');
    ben = await person('Ben', 'ben@example.com');
    await signIn('ana', 'ana@example.com');
    await signIn('ben', 'ben@example.com');
    today = (await http().get('/my').set(as('ana')).expect(200)).body.today;
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  let anaFirstAid = '';

  it('lists what their role needs and what they can add, the ones asked of them first', async () => {
    const r = await http().get('/my/credentials').set(as('ana')).expect(200);
    expect(r.body.credentials).toEqual([]);
    expect(r.body.needs).toEqual([
      { credentialTypeId: firstAid, typeName: 'First aid', must: true, problem: 'missing', line: 'Add your First aid', canAdd: true },
      { credentialTypeId: foodSafety, typeName: 'Food safety', must: false, problem: 'missing', line: 'Add your Food safety', canAdd: true },
    ]);
    expect(r.body.types.map((t: { name: string; level: string | null }) => [t.name, t.level])).toEqual([
      ['First aid', 'hard'], ['Food safety', 'warning'], ['Barista course', 'optional'],
    ]);
    // Another business's credential types never show.
    expect(JSON.stringify(r.body)).not.toContain(otherType);
  });

  it('adds a credential that starts unchecked, and refuses a second one waiting or bad dates', async () => {
    await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: firstAid }).expect(400);
    const past = await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: firstAid, expiryDate: addDays(today, -1) }).expect(400);
    expect(past.body.message).toBe('This has already run out. Add it once you have the new one.');
    await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: otherType, expiryDate: addDays(today, 300) }).expect(404);
    const r = await http().post('/my/credentials').set(as('ana'))
      .send({ credentialTypeId: firstAid, expiryDate: addDays(today, 300), issueDate: today, issuedBy: 'Example Training' }).expect(201);
    expect(r.body).toMatchObject({ typeName: 'First aid', check: 'to_check' });
    anaFirstAid = r.body.id;
    const told = (await owner.query(`select to_address as to, subject from notifications where template = 'app_credential_added'`)).rows;
    expect(told).toEqual([{ to: 'admin@x.com', subject: 'Ana Example added a credential in the app' }]);
    const again = await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: firstAid, expiryDate: addDays(today, 200) }).expect(409);
    expect(again.body.message).toMatch(/^You've already added a First aid that the office hasn't checked yet/);

    const list = (await http().get('/my/credentials').set(as('ana')).expect(200)).body;
    expect(list.credentials).toEqual([expect.objectContaining({
      id: anaFirstAid, typeName: 'First aid', issuedBy: 'Example Training', check: 'to_check', status: 'valid', files: [], canAddFiles: true,
    })]);
    expect(list.needs[0]).toMatchObject({ typeName: 'First aid', problem: 'unverified', line: 'First aid: waiting for the office to check it', canAdd: false });

    // The office sees it waiting, marked as added in the app, and the history says so.
    const person = (await http().get(`/workers/${ana}`).set(as('admin')).expect(200)).body;
    expect(person.credentials[0]).toMatchObject({ id: anaFirstAid, verification: 'unverified', addedInApp: true });
    const h = (await http().get(`/workers/${ana}/credentials/${anaFirstAid}/history`).set(as('admin')).expect(200)).body;
    expect(h[0]).toMatchObject({ action: 'created', details: expect.objectContaining({ via: 'app' }) });
  });

  it('takes a photo or file for their own credential while it waits to be checked', async () => {
    const up = await http().post(`/my/credentials/${anaFirstAid}/documents`).set(as('ana')).attach('file', PNG, 'photo.png').expect(201);
    expect(up.body).toMatchObject({ filename: 'photo.png' });
    await http().post(`/my/credentials/${anaFirstAid}/documents`).set(as('ana')).attach('file', Buffer.from('<html>'), 'x.pdf').expect(400);
    // Ben can't add to Ana's, and the other business can't either.
    await http().post(`/my/credentials/${anaFirstAid}/documents`).set(as('ben')).attach('file', PDF, 'x.pdf').expect(404);
    await http().post(`/my/credentials/${anaFirstAid}/documents`).set(as('other')).attach('file', PDF, 'x.pdf').expect(404);
    const person = (await http().get(`/workers/${ana}`).set(as('admin')).expect(200)).body;
    expect(person.credentials[0]).toMatchObject({ evidence: 'uploaded', documents: [{ filename: 'photo.png' }] });
    expect((await http().get('/my/credentials').set(as('ana')).expect(200)).body.credentials[0].files).toEqual(['photo.png']);

    // Once the office has checked it, it's closed to the app; the requirement is met.
    await http().post(`/workers/${ana}/credentials/${anaFirstAid}/verify`).set(as('admin')).send({}).expect(201);
    const closed = await http().post(`/my/credentials/${anaFirstAid}/documents`).set(as('ana')).attach('file', PDF, 'x.pdf').expect(409);
    expect(closed.body.message).toMatch(/already checked/);
    const list = (await http().get('/my/credentials').set(as('ana')).expect(200)).body;
    expect(list.credentials[0]).toMatchObject({ check: 'checked', canAddFiles: false });
    expect(list.needs.map((n: { typeName: string }) => n.typeName)).toEqual(['Food safety']);
    // A renewal can be added while the checked one stands.
    await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: firstAid, expiryDate: addDays(today, 700) }).expect(201);
  });

  it('shows their onboarding checklist worded for them, and adds its credentials to what they need', async () => {
    expect((await http().get('/my/onboarding').set(as('ana')).expect(200)).body).toEqual({ onboarding: null });
    const checklist = (await http().post('/onboarding-checklists').set(as('admin')).send({
      name: 'New kitchen staff',
      steps: [
        { kind: 'right_to_work', title: 'Right to work' },
        { kind: 'credential', title: 'Barista course', credentialTypeId: barista },
        { kind: 'task', title: 'Contract signed' },
      ],
    }).expect(201)).body;
    await http().post(`/workers/${ben}/onboarding`).set(as('admin')).send({ checklistId: checklist.id }).expect(201);

    let mine = (await http().get('/my/onboarding').set(as('ben')).expect(200)).body.onboarding;
    expect(mine).toMatchObject({ checklistName: 'New kitchen staff', done: 1, total: 3, ready: false, line: '1 of 3 done' });
    expect(mine.steps.map((s: { title: string; line: string; yours: boolean }) => [s.title, s.line, s.yours])).toEqual([
      ['Right to work', 'Checked', false],
      ['Barista course', 'Add it in Credentials', true],
      ['Contract signed', 'The office will tick this off', false],
    ]);
    // Nothing written for the office (who ticked, notes) reaches the app.
    expect(JSON.stringify(mine)).not.toMatch(/detail|byName|note/);

    // Barista course is only optional for a chef, but onboarding asks for it, so the Credentials tab lists it.
    const creds = (await http().get('/my/credentials').set(as('ben')).expect(200)).body;
    expect(creds.needs).toContainEqual({ credentialTypeId: barista, typeName: 'Barista course', must: true, problem: 'missing', line: 'Add your Barista course', canAdd: true });

    await http().post('/my/credentials').set(as('ben')).send({ credentialTypeId: barista }).expect(201);
    mine = (await http().get('/my/onboarding').set(as('ben')).expect(200)).body.onboarding;
    expect(mine.steps[1]).toMatchObject({ state: 'waiting', line: 'Sent: waiting for the office to check it', yours: false });
    const after = (await http().get('/my/credentials').set(as('ben')).expect(200)).body;
    expect(after.needs.map((n: { credentialTypeId: string }) => n.credentialTypeId)).not.toContain(barista);
    // The other business's people see nothing of it.
    await http().get('/my/onboarding').set(as('other')).expect(404);
  });

  it('is only for people linked to someone here', async () => {
    await http().get('/my/credentials').set(as('admin')).expect(404);
    await http().post('/my/credentials').set(as('admin')).send({ credentialTypeId: foodSafety }).expect(404);
    expect(ben).toBeTruthy();
  });
});
