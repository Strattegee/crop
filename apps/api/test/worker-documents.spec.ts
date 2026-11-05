import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { auditStore, createPool, withTenant } from '@crop/db';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client, type Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { DOCUMENT_STORE, MemoryStore } from '../src/documents/document-store.js';
import { documentLabel, documentRefusal, MAX_DOCUMENTS, parseDocumentFields } from '../src/workforce/worker-documents.js';
import { startFakeIdp } from './fake-idp.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

describe('document rules', () => {
  it('reads the kind and title', () => {
    expect(parseDocumentFields({ kind: 'cv' })).toEqual({ kind: 'cv', title: null });
    expect(parseDocumentFields({ kind: 'contract', title: '  Signed   2026 ' })).toEqual({ kind: 'contract', title: 'Signed 2026' });
    expect(parseDocumentFields({ kind: 'other', title: '' })).toEqual({ problem: 'Say what the document is' });
    expect(parseDocumentFields({})).toEqual({ problem: 'Say what the document is' });
    expect(parseDocumentFields({ kind: 'passport' })).toEqual({ problem: 'Choose what kind of document it is' });
    expect(parseDocumentFields({ kind: 'cv', title: 'x'.repeat(121) })).toHaveProperty('problem');
  });
  it('labels and limits', () => {
    expect(documentLabel({ kind: 'cv', title: null })).toBe('CV');
    expect(documentLabel({ kind: 'contract', title: 'Casual agreement' })).toBe('Casual agreement');
    expect(documentRefusal(undefined, 0)).toBe('Person not found');
    expect(documentRefusal({ status: 'agency' }, 0)).toMatch(/agency's to keep/);
    expect(documentRefusal({ status: 'active' }, MAX_DOCUMENTS)).toMatch(/up to 50/);
    expect(documentRefusal({ status: 'applicant' }, 3)).toBeNull();
  });
});

describe('documents on a person\'s record', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let appPool: Pool;
  const store = new MemoryStore();
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = await createTestDatabase('crop_worker_docs');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cfy','Demo'),('other','Other') returning id, slug`);
    ids.cfy = t.rows.find(r => r.slug === 'cfy')!.id;
    ids.other = t.rows.find(r => r.slug === 'other')!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'alloc@x.com','allocator'),($1,'wk@x.com','worker'),($2,'o@x.com','owner')`, [ids.cfy, ids.other]);
    for (const [sub, email] of [['alloc', 'alloc@x.com'], ['wk', 'wk@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DOCUMENT_STORE).useValue(store).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    appPool = createPool(db.appUrl);
    ids.jo = (await http().post('/workers').set(as('alloc')).send({ firstName: 'Jo', lastName: 'Example' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await appPool?.end();
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  const upload = (who: string, fields: Record<string, string>, file: Buffer | null = PDF, name = 'cv.pdf') => {
    const r = http().post(`/workers/${ids.jo}/documents`).set(as(who));
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return file ? r.attach('file', file, name) : r;
  };

  it('keeps a CV, a contract and other documents, opens and removes them', async () => {
    await http().get(`/workers/${ids.jo}/documents`).set(as('alloc')).expect(200).expect({ documents: [] });
    await upload('alloc', { kind: 'other' }).expect(400);
    await upload('alloc', { kind: 'cv' }, Buffer.from('<html>'), 'cv.html').expect(400);
    await upload('alloc', { kind: 'cv' }, null).expect(400);
    expect(store.objects.size).toBe(0);
    const cv = (await upload('alloc', { kind: 'cv' }).expect(201)).body;
    expect(cv).toMatchObject({ kind: 'cv', label: 'CV', filename: 'cv.pdf', source: 'office', contentType: 'application/pdf' });
    await upload('alloc', { kind: 'other', title: 'Induction form' }, PDF, 'induction.pdf').expect(201);
    await upload('alloc', { kind: 'contract' }, PDF, 'contract.pdf').expect(201);
    const list = (await http().get(`/workers/${ids.jo}/documents`).set(as('alloc')).expect(200)).body.documents;
    expect(list.map((d: { label: string }) => d.label)).toEqual(['CV', 'Contract', 'Induction form']);
    const key = (await owner.query(`select storage_key from worker_documents where id = $1`, [cv.id])).rows[0].storage_key;
    expect(key).toMatch(new RegExp(`^${ids.cfy}/worker-documents/`));
    expect(key).not.toMatch(/jo|cv/i);
    expect((await http().get(`/worker-documents/${cv.id}/link`).set(as('alloc')).expect(200)).body.url).toMatch(/^https:\/\/storage.test\//);

    expect((await http().post(`/worker-documents/${cv.id}/remove`).set(as('alloc')).expect(200)).body).toEqual({ removed: true, filename: 'cv.pdf' });
    await http().post(`/worker-documents/${cv.id}/remove`).set(as('alloc')).expect(404);
    await http().get(`/worker-documents/${cv.id}/link`).set(as('alloc')).expect(404);
    expect((await http().get(`/workers/${ids.jo}/documents`).set(as('alloc')).expect(200)).body.documents).toHaveLength(2);
    // The file is kept and the audit log shows who did it.
    expect(store.objects.size).toBe(3);
    const rows = (await owner.query(`select action from audit_log where table_name = 'worker_documents' order by id`)).rows.map(r => r.action);
    expect(rows).toEqual(['insert', 'insert', 'insert', 'update']);
  });

  it('is for the office of that business only', async () => {
    await http().get(`/workers/${ids.jo}/documents`).set(as('wk')).expect(403);
    await upload('wk', { kind: 'cv' }).expect(403);
    await http().get(`/workers/${ids.jo}/documents`).set(as('other')).expect(404);
    await upload('other', { kind: 'cv' }).expect(404);
    const doc = (await owner.query(`select id from worker_documents where removed_at is null limit 1`)).rows[0].id;
    await http().get(`/worker-documents/${doc}/link`).set(as('other')).expect(404);
    await http().post(`/worker-documents/${doc}/remove`).set(as('other')).expect(404);
    // Supervisors never reach them, even on their sites.
    const count = (c: { query: (q: string) => Promise<{ rows: { n: number }[] }> }) => c.query('select count(*)::int as n from worker_documents').then(r => r.rows[0].n);
    expect(await auditStore.run({ scope: { tenantId: ids.cfy, role: 'supervisor', sites: [] } }, () => withTenant(appPool, ids.cfy, count))).toBe(0);
    expect(await auditStore.run({ scope: { tenantId: ids.cfy, role: 'allocator', sites: null } }, () => withTenant(appPool, ids.cfy, count))).toBe(3);
  });

  it('never edits or deletes what was kept', async () => {
    await expect(withTenant(appPool, ids.cfy, c => c.query(`update worker_documents set filename = 'x.pdf'`))).rejects.toThrow(/permission/);
    await expect(withTenant(appPool, ids.cfy, c => c.query(`delete from worker_documents`))).rejects.toThrow(/permission/);
  });
});
