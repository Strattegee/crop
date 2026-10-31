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
import { appRightToWorkEmail, myRightToWork, myRightToWorkFileRefusal, myStep } from '../src/worker-app/worker-app.js';
import { startFakeIdp } from './fake-idp.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe('right to work in the app: pure rules', () => {
  const rec = (verification: string, files: string[] = [], status = 'citizen', visaExpiry: string | null = null) => ({ status, verification, visaExpiry, files });

  it('says what the person can do about their right to work', () => {
    expect(myRightToWork(null, 'missing')).toMatchObject({ state: 'none', canAddFiles: false, statusLabel: null });
    expect(myRightToWork(null, 'missing').line).toMatch(/^The office records your right to work/);
    expect(myRightToWork(rec('unverified'), 'unverified')).toMatchObject({
      state: 'to_check', canAddFiles: true, statusLabel: 'Australian citizen',
      line: 'Send a photo or file of your proof, for example your passport, citizenship certificate or visa grant',
    });
    expect(myRightToWork(rec('unverified', ['a.pdf']), 'unverified')).toMatchObject({ line: 'Sent: the office is checking it', canAddFiles: true });
    expect(myRightToWork(rec('unverified', Array(10).fill('a.pdf')), 'unverified').canAddFiles).toBe(false);
    expect(myRightToWork(rec('rejected', ['a.pdf']), 'rejected')).toMatchObject({ state: 'not_accepted', canAddFiles: true });
    expect(myRightToWork(rec('verified'), null)).toMatchObject({ state: 'checked', line: 'Checked by the office', canAddFiles: false });
    expect(myRightToWork(rec('verified', [], 'visa_holder', '2026-12-01'), 'expiring')).toMatchObject({
      statusLabel: 'Visa holder', visaExpiry: '2026-12-01', line: 'Checked. Your visa runs out soon: contact the office when you have your new one.',
    });
    expect(myRightToWork(rec('unverified', [], 'visa_holder', '2026-01-01'), 'expired').line).toBe('Your visa has run out: please contact the office');
    // A visa expiry is only shown for a visa holder.
    expect(myRightToWork(rec('verified', [], 'citizen', '2030-01-01'), null).visaExpiry).toBeNull();
  });

  it('refuses files it should not take', () => {
    expect(myRightToWorkFileRefusal(null)).toMatch(/record your right to work details first/);
    expect(myRightToWorkFileRefusal({ verification: 'verified', files: 0 })).toMatch(/already checked/);
    expect(myRightToWorkFileRefusal({ verification: 'unverified', files: 10 })).toBe('You can send up to 10 files for your right to work');
    expect(myRightToWorkFileRefusal({ verification: 'rejected', files: 1 })).toBeNull();
  });

  it('points the onboarding step at the app once the office has recorded the details', () => {
    const step = (state: 'waiting' | 'to_do') => ({ id: 'x', title: 'Right to work', kind: 'right_to_work' as const, required: true, credentialTypeId: null, state, detail: '' });
    expect(myStep(step('waiting'), 'Tickets', myRightToWork(rec('unverified'), 'unverified')))
      .toMatchObject({ yours: true, line: 'Send a photo or file of your proof in Tickets' });
    expect(myStep(step('waiting'), 'Tickets', myRightToWork(rec('unverified', ['a.pdf']), 'unverified')))
      .toMatchObject({ yours: false, line: 'Sent: the office is checking it' });
    expect(myStep(step('to_do'), 'Tickets', myRightToWork(rec('rejected', ['a.pdf']), 'rejected')))
      .toMatchObject({ yours: true, line: 'Not accepted: send your proof again in Tickets' });
    expect(myStep(step('to_do'), 'Tickets', myRightToWork(null, 'missing')))
      .toMatchObject({ yours: false, line: 'Please contact the office about your right to work' });
  });

  it('tells the office without any numbers', () => {
    const m = appRightToWorkEmail({ name: 'Ana Example', workerId: 'w1' }, 'https://crop.example/');
    expect(m.subject).toBe('Ana Example sent proof of their right to work in the app');
    expect(m.body).toContain('https://crop.example/workers/w1?tab=rtw');
  });
});

describe('right to work in the worker app', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const store = new MemoryStore();
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let ana: string, ben: string;
  const signIn = async (sub: string, email: string) => {
    idp.addUser({ sub, email, email_verified: true, name: sub });
    tok[sub] = await idp.token(sub, { expiresIn: '1h' });
  };

  beforeAll(async () => {
    db = await createTestDatabase('crop_my_rtw');
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

    const person = async (firstName: string, email: string) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Chef'], email }).expect(201)).body.id as string;
      await http().post(`/workers/${w}/app-access`).set(as('admin')).expect(201);
      return w;
    };
    ana = await person('Ana', 'ana@example.com');
    ben = await person('Ben', 'ben@example.com');
    await signIn('ana', 'ana@example.com');
    await signIn('ben', 'ben@example.com');
    await http().get('/my').set(as('ana')).expect(200);
    await http().get('/my').set(as('ben')).expect(200);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('asks them to contact the office until the details are recorded, and takes no file before then', async () => {
    const r = (await http().get('/my/right-to-work').set(as('ana')).expect(200)).body;
    expect(r).toMatchObject({ state: 'none', canAddFiles: false });
    const creds = (await http().get('/my/credentials').set(as('ana')).expect(200)).body;
    expect(creds.rightToWork).toMatchObject({ state: 'none' });
    expect(creds.needs).toContainEqual(expect.objectContaining({ credentialTypeId: 'right-to-work', line: expect.stringMatching(/^Right to work: the office records/), canAdd: false }));
    const refused = await http().post('/my/right-to-work/documents').set(as('ana')).attach('file', PDF, 'passport.pdf').expect(409);
    expect(refused.body.message).toMatch(/record your right to work details first/);
    expect(store.objects.size).toBe(0);
  });

  it('takes photos or files of their proof once the office has recorded the details, and tells the office', async () => {
    await http().put(`/workers/${ana}/right-to-work`).set(as('admin'))
      .send({ status: 'citizen', citizenProofType: 'au_passport', documentNumber: 'PA0000000' }).expect(200);
    expect((await http().get('/my/right-to-work').set(as('ana')).expect(200)).body).toMatchObject({
      state: 'to_check', statusLabel: 'Australian citizen', files: [], canAddFiles: true,
    });
    // Never the document number.
    expect(JSON.stringify((await http().get('/my/credentials').set(as('ana')).expect(200)).body)).not.toContain('PA0000000');

    await http().post('/my/right-to-work/documents').set(as('ana')).attach('file', Buffer.from('<html>'), 'x.pdf').expect(400);
    const up = await http().post('/my/right-to-work/documents').set(as('ana')).attach('file', PNG, 'passport.png').expect(201);
    expect(up.body).toMatchObject({ filename: 'passport.png', rightToWork: { files: ['passport.png'], line: 'Sent: the office is checking it' } });

    // The office sees it on the record, with the history saying it came from the app.
    const office = (await http().get(`/workers/${ana}/right-to-work`).set(as('admin')).expect(200)).body;
    expect(office.current.documents.map((d: { filename: string }) => d.filename)).toEqual(['passport.png']);
    const ev = (await owner.query(`select action, details->>'via' as via, actor_user_id is not null as actor from right_to_work_events order by at desc limit 1`)).rows[0];
    expect(ev).toEqual({ action: 'evidence_added', via: 'app', actor: true });
    const told = (await owner.query(`select to_address as to, subject, body from notifications where template = 'app_right_to_work_added'`)).rows;
    expect(told).toEqual([expect.objectContaining({ to: 'admin@x.com', subject: 'Ana Example sent proof of their right to work in the app' })]);
    expect(told[0].body).not.toContain('PA0000000');
  });

  it('only ever adds to their own record, and stops once the office has checked it', async () => {
    // Ben has nothing recorded, so his file can't land anywhere; the other business's owner isn't linked to anyone here.
    await http().post('/my/right-to-work/documents').set(as('ben')).attach('file', PDF, 'x.pdf').expect(409);
    await http().post('/my/right-to-work/documents').set(as('other')).attach('file', PDF, 'x.pdf').expect(404);
    await http().get('/my/right-to-work').set(as('admin')).expect(404);
    expect((await http().get(`/workers/${ben}/right-to-work`).set(as('admin')).expect(200)).body.current).toBeNull();

    await http().post(`/workers/${ana}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    const closed = await http().post('/my/right-to-work/documents').set(as('ana')).attach('file', PDF, 'x.pdf').expect(409);
    expect(closed.body.message).toMatch(/already checked/);
    expect((await http().get('/my/right-to-work').set(as('ana')).expect(200)).body).toMatchObject({ state: 'checked', canAddFiles: false });
  });

  it('points their onboarding step at the app', async () => {
    const checklist = (await http().post('/onboarding-checklists').set(as('admin')).send({
      name: 'Starters', steps: [{ kind: 'right_to_work', title: 'Right to work' }],
    }).expect(201)).body;
    await http().post(`/workers/${ben}/onboarding`).set(as('admin')).send({ checklistId: checklist.id }).expect(201);
    let step = (await http().get('/my/onboarding').set(as('ben')).expect(200)).body.onboarding.steps[0];
    expect(step).toMatchObject({ yours: false, line: 'Please contact the office about your right to work' });

    await http().put(`/workers/${ben}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'birth_certificate' }).expect(200);
    step = (await http().get('/my/onboarding').set(as('ben')).expect(200)).body.onboarding.steps[0];
    expect(step).toMatchObject({ yours: true, line: 'Send a photo or file of your proof in Credentials' });
    await http().post('/my/right-to-work/documents').set(as('ben')).attach('file', PDF, 'birth.pdf').expect(201);
    step = (await http().get('/my/onboarding').set(as('ben')).expect(200)).body.onboarding.steps[0];
    expect(step).toMatchObject({ yours: false, state: 'waiting', line: 'Sent: the office is checking it' });
  });
});
