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
import { DOC_DEFAULTS, DOC_FIELDS, DOC_RULES, accessList, accessOf, docAccess, parseAccess, FIELD_DEFAULTS } from '../src/workforce/field-access.js';
import { myNeedFor, myRightToWork, myRightToWorkSeeOnly, myStep } from '../src/worker-app/worker-app.js';
import { startFakeIdp } from './fake-idp.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

describe('document access: rules (David, 3 Nov, answer 5 "and each document")', () => {
  it('lets people send every kind of document by default, as before', () => {
    expect(Object.values(DOC_DEFAULTS).every(a => a === 'approve')).toBe(true);
    for (const f of DOC_FIELDS) expect(DOC_RULES[f].allowed).not.toContain('change');
    expect(DOC_RULES.doc_right_to_work.allowed).toEqual(['see', 'approve']);
  });

  it('reads and refuses document levels with the reason', () => {
    expect(parseAccess({ fields: { doc_vaccination: 'hidden', doc_licence: 'see' } })).toEqual({ changes: { doc_vaccination: 'hidden', doc_licence: 'see' } });
    expect(parseAccess({ fields: { doc_licence: 'change' } })).toMatchObject({ problem: 'Licences can’t be “they can send it; the office checks it”: The office always checks a document.' });
    expect(parseAccess({ fields: { doc_right_to_work: 'hidden' } })).toMatchObject({ problem: expect.stringMatching(/^Right to work can’t be “office only”: .*nobody can be rostered without it/) });
  });

  it('maps a credential category to its setting, and lists documents after details', () => {
    const a = accessOf([{ field: 'doc_vaccination', person: 'hidden' }, { field: 'doc_check', person: 'change' }]);
    expect(docAccess(a, 'vaccination')).toBe('hidden');
    expect(docAccess(a, 'check')).toBe('approve');
    expect(docAccess(a, 'something_new')).toBe('approve');
    const list = accessList(a);
    expect(list.filter(r => r.group === 'details').map(r => r.field)).toEqual(Object.keys(FIELD_DEFAULTS));
    expect(list.filter(r => r.group === 'documents').map(r => r.field)).toEqual([...DOC_FIELDS]);
    expect(list.find(r => r.field === 'doc_vaccination')).toMatchObject({ person: 'hidden', isDefault: false, defaultPerson: 'approve' });
  });

  it('words what the app says when the office keeps a document', () => {
    const i = (problem: string) => ({ typeName: 'Police check', problem, credentialTypeId: 'x' });
    expect(myNeedFor(i('missing'), true)).toEqual({ line: 'Add your Police check', canAdd: true });
    expect(myNeedFor(i('missing'), false)).toEqual({ line: 'Police check: please contact the office', canAdd: false });
    expect(myNeedFor(i('unverified'), false)).toEqual({ line: 'Police check: waiting for the office to check it', canAdd: false });
    const step = myStep({ id: 's', title: 'Police check', kind: 'credential', required: true, credentialTypeId: 'x', state: 'to_do', detail: 'Not recorded yet' },
      'Credentials', null, () => false);
    expect(step).toMatchObject({ yours: false, line: 'The office looks after this: please contact them' });
    const r = myRightToWork({ status: 'citizen', verification: 'unverified', visaExpiry: null, files: [] }, 'unverified');
    expect(r.canAddFiles).toBe(true);
    expect(myRightToWorkSeeOnly(r)).toMatchObject({ canAddFiles: false, line: 'The office is looking after your right to work. Please contact them about your proof.' });
    expect(myRightToWorkSeeOnly(myRightToWork(null, 'missing')).line).toBe('The office records your right to work. Please contact them.');
  });
});

describe('document access in the worker app', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const store = new MemoryStore();
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let ana: string, police: string, flu: string, firstAid: string, anaFlu: string, anaPolice: string;
  const signIn = async (sub: string, email: string) => {
    idp.addUser({ sub, email, email_verified: true, name: sub });
    tok[sub] = await idp.token(sub, { expiresIn: '1h' });
  };

  beforeAll(async () => {
    db = await createTestDatabase('crop_document_access');
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

    const type = async (name: string, category: string) =>
      (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category, has_number, has_expiry) values ($1,$2,$3,false,false) returning id`,
        [id('cafe'), name, category])).rows[0].id;
    police = await type('Police check', 'check');
    flu = await type('Flu vaccination', 'vaccination');
    firstAid = await type('First aid', 'training');
    await owner.query(`insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity)
      values ($1,$2,'role','Carer','hard'), ($1,$3,'role','Carer','hard'), ($1,$4,'role','Carer','hard')`, [id('cafe'), police, flu, firstAid]);
    ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Carer'], email: 'ana@example.com' }).expect(201)).body.id;
    await http().put(`/workers/${ana}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
    await http().post(`/workers/${ana}/app-access`).set(as('admin')).expect(201);
    await signIn('ana', 'ana@example.com');
    await http().get('/my').set(as('ana')).expect(200);
    // Sent while the business still lets them send everything (CROP's default).
    anaFlu = (await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: flu }).expect(201)).body.id;
    anaPolice = (await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: police }).expect(201)).body.id;
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lists the document kinds with their own words', async () => {
    const r = await http().get('/field-access').set(as('admin')).expect(200);
    expect(r.body.fields.filter((f: { group: string }) => f.group === 'documents').map((f: { label: string }) => f.label))
      .toEqual(['Licences', 'Registrations', 'Training and tickets', 'Checks', 'Vaccinations', 'Right to work']);
    expect(r.body.docWords.approve).toBe('They can send it; the office checks it');
    await http().put('/field-access').set(as('admin')).send({ fields: { doc_check: 'change' } }).expect(400);
  });

  it('hides office-only kinds, and shows see-only kinds without letting them send', async () => {
    await http().put('/field-access').set(as('admin')).send({ fields: { doc_vaccination: 'hidden', doc_check: 'see', doc_right_to_work: 'see' } }).expect(200);
    const r = await http().get('/my/credentials').set(as('ana')).expect(200);
    expect(r.body.credentials.map((c: { typeName: string; canAddFiles: boolean }) => [c.typeName, c.canAddFiles])).toEqual([['Police check', false]]);
    expect(JSON.stringify(r.body)).not.toMatch(/vaccination/i);
    expect(r.body.types.map((t: { name: string }) => t.name)).toEqual(['First aid']);
    expect(r.body.needs.find((n: { typeName: string }) => n.typeName === 'First aid')).toMatchObject({ canAdd: true });
    expect(r.body.needs.find((n: { typeName: string }) => n.typeName === 'Police check')).toMatchObject({ canAdd: false, line: 'Police check: waiting for the office to check it' });
    expect(r.body.rightToWork).toMatchObject({ canAddFiles: false, line: 'The office is looking after your right to work. Please contact them about your proof.' });
  });

  it('refuses sending what the office keeps', async () => {
    const no = await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: police }).expect(403);
    expect(no.body.message).toBe('The office looks after credentials like this one: please contact them');
    await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: flu }).expect(403);
    await http().post(`/my/credentials/${anaPolice}/documents`).set(as('ana')).attach('file', PDF, 'check.pdf').expect(403);
    await http().post(`/my/credentials/${anaFlu}/documents`).set(as('ana')).attach('file', PDF, 'flu.pdf').expect(404);
    await http().post('/my/right-to-work/documents').set(as('ana')).attach('file', PDF, 'passport.pdf').expect(403);
    // Nothing was stored for the refused files.
    expect((await owner.query(`select count(*)::int as n from credential_documents`)).rows[0].n).toBe(0);
    // First aid is still theirs to send.
    await http().post('/my/credentials').set(as('ana')).send({ credentialTypeId: firstAid }).expect(201);
  });

  it('says on their checklist that the office looks after it', async () => {
    const list = (await http().post('/onboarding-checklists').set(as('admin')).send({
      name: 'Carers', steps: [{ kind: 'credential', title: 'Flu vaccination', credentialTypeId: flu, required: true }],
    }).expect(201)).body.id;
    await http().post(`/workers/${ana}/onboarding`).set(as('admin')).send({ checklistId: list, hold: false }).expect(201);
    // Her own flu record is waiting to be checked, so turn it down to make the step hers again.
    await http().post(`/workers/${ana}/credentials/${anaFlu}/reject`).set(as('admin')).send({ reason: 'Unreadable' }).expect(201);
    const r = await http().get('/my/onboarding').set(as('ana')).expect(200);
    const step = r.body.onboarding.steps[0];
    expect(step).toMatchObject({ yours: false, line: 'The office looks after this: please contact them' });
  });

  it('goes back to sending once the business allows it again', async () => {
    await http().put('/field-access').set(as('admin')).send({ fields: { doc_vaccination: 'approve', doc_check: 'approve', doc_right_to_work: 'approve' } }).expect(200);
    const r = await http().get('/my/credentials').set(as('ana')).expect(200);
    expect(r.body.types.map((t: { name: string }) => t.name).sort()).toEqual(['First aid', 'Flu vaccination', 'Police check']);
    await http().post(`/my/credentials/${anaPolice}/documents`).set(as('ana')).attach('file', PDF, 'check.pdf').expect(201);
    await http().post('/my/right-to-work/documents').set(as('ana')).attach('file', PDF, 'passport.pdf').expect(201);
  });

  it('is the business’s own: another business keeps the defaults', async () => {
    const r = await http().get('/field-access').set(as('other')).expect(200);
    expect(r.body.fields.every((f: { isDefault: boolean }) => f.isDefault)).toBe(true);
  });
});
