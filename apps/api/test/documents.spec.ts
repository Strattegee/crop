import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { DisabledStore, DOCUMENT_STORE, MemoryStore } from '../src/documents/document-store.js';
import { cleanFilename, sniffType } from '../src/documents/sniff.js';
import { startFakeIdp } from './fake-idp.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe('file type and name checks', () => {
  it('recognises files by their content, not their name', () => {
    expect(sniffType(PDF)).toBe('application/pdf');
    expect(sniffType(PNG)).toBe('image/png');
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffType(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(8)]))).toBe('image/heic');
    expect(sniffType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
  });
  it('keeps only a safe file name', () => {
    expect(cleanFilename('C:\\Users\\jo\\police check.pdf')).toBe('police check.pdf');
    expect(cleanFilename('../../etc/passwd')).toBe('passwd');
    expect(cleanFilename('a\u0000b.pdf')).toBe('ab.pdf');
    expect(cleanFilename(undefined)).toBe('document');
  });
});

describe('credential documents', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const store = new MemoryStore();
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let base = '';

  beforeAll(async () => {
    db = await createTestDatabase('crop_docs_api');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cfy','Demo'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'alloc@x.com','allocator'),($1,'wk@x.com','worker'),($2,'o@x.com','owner')`, [id('cfy'), id('other')]);
    await owner.end();
    for (const [sub, email] of [['alloc', 'alloc@x.com'], ['wk', 'wk@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DOCUMENT_STORE).useValue(store).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    const ct = await http().post('/credential-types').set(as('other')).send({ name: 'Unused', category: 'check' }); // other agency's data
    expect(ct.status).toBe(201);
    const w = await http().post('/workers').set(as('alloc')).send({ firstName: 'Jo', lastName: 'Citizen' }).expect(201);
    const owner2 = new Client({ connectionString: db.ownerUrl });
    await owner2.connect();
    const type = await owner2.query(`insert into credential_types(tenant_id, name, category, has_number, has_expiry) values ($1,'CPR','training',false,false) returning id`, [id('cfy')]);
    await owner2.end();
    const c = await http().post(`/workers/${w.body.id}/credentials`).set(as('alloc')).send({ credentialTypeId: type.rows[0].id }).expect(201);
    base = `/workers/${w.body.id}/credentials/${c.body.id}`;
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  let docId = '';

  it('uploads a PDF, marks the evidence uploaded and records it in the history', async () => {
    const res = await http().post(`${base}/documents`).set(as('alloc')).attach('file', PDF, 'CPR certificate.pdf').expect(201);
    docId = res.body.id;
    expect(res.body).toMatchObject({ filename: 'CPR certificate.pdf', contentType: 'application/pdf', sizeBytes: PDF.length });
    expect([...store.objects.values()][0].body.equals(PDF)).toBe(true);
    const key = [...store.objects.keys()][0];
    expect(key).not.toContain('CPR'); // no names in storage keys
    const workerId = base.split('/')[2];
    const w = await http().get(`/workers/${workerId}`).set(as('alloc')).expect(200);
    expect(w.body.credentials[0]).toMatchObject({ evidence: 'uploaded', verification: 'unverified', documents: [{ filename: 'CPR certificate.pdf' }] });
    const h = await http().get(`${base}/history`).set(as('alloc')).expect(200);
    expect(h.body.map((e: { action: string }) => e.action)).toEqual(['created', 'evidence_added']);
  });

  it('gives a short-lived link to open it', async () => {
    const res = await http().get(`${base}/documents/${docId}/link`).set(as('alloc')).expect(200);
    expect(res.body).toMatchObject({ expiresInSeconds: 300 });
    expect(res.body.url).toMatch(/^https:\/\/storage\.test\/.+expires=300$/);
  });

  it('refuses files that are not PDFs or images, whatever they are called', async () => {
    await http().post(`${base}/documents`).set(as('alloc')).attach('file', Buffer.from('<html>hi</html>'), 'cert.pdf').expect(400);
    await http().post(`${base}/documents`).set(as('alloc')).expect(400);
  });

  it('refuses files over 10 MB', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    await http().post(`${base}/documents`).set(as('alloc')).attach('file', big, 'big.pdf').expect(413);
  });

  it('keeps documents private to the agency and office staff', async () => {
    await http().get(`${base}/documents`).set(as('other')).expect(404);
    await http().get(`${base}/documents/${docId}/link`).set(as('other')).expect(404);
    await http().get(`${base}/documents`).set(as('wk')).expect(403);
  });

  it('removing the last document sets evidence back to missing', async () => {
    await http().delete(`${base}/documents/${docId}`).set(as('alloc')).expect(200);
    const list = await http().get(`${base}/documents`).set(as('alloc')).expect(200);
    expect(list.body).toEqual([]);
    const workerId = base.split('/')[2];
    const w = await http().get(`/workers/${workerId}`).set(as('alloc')).expect(200);
    expect(w.body.credentials[0].evidence).toBe('missing');
    await http().delete(`${base}/documents/${docId}`).set(as('alloc')).expect(404);
  });
});

describe('when storage is not configured', () => {
  it('explains that uploads are not available yet', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DOCUMENT_STORE).useValue(new DisabledStore()).compile();
    expect(mod.get(DOCUMENT_STORE).configured).toBe(false);
    await mod.close();
  });
});
