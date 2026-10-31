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
import { addDays, todayIn } from '../src/workforce/compliance.js';
import { linkNeeds, linkState, rightToWorkNeeded } from '../src/workforce/upload-links.js';
import { askMessage } from '../src/workforce/onboarding.js';
import { startFakeIdp } from './fake-idp.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

describe('upload link rules (David, 29 Oct)', () => {
  it('asks for what onboarding still needs and what the roles need, must-haves first, once each', () => {
    const needs = linkNeeds(
      [
        { credentialTypeId: 'a', typeName: 'First aid', severity: 'hard', problem: 'missing' },
        { credentialTypeId: 'b', typeName: 'Police check', severity: 'warning', problem: 'expired' },
        { credentialTypeId: 'c', typeName: 'Driver licence', severity: 'hard', problem: 'unverified' },
        { credentialTypeId: 'right-to-work', typeName: 'Right to work', severity: 'hard', problem: 'missing' },
      ],
      [
        { kind: 'credential', credentialTypeId: 'b', typeName: 'Police check', required: false, state: 'to_do' },
        { kind: 'credential', credentialTypeId: 'd', typeName: 'CPR', required: true, state: 'to_do' },
        { kind: 'credential', credentialTypeId: 'e', typeName: 'Induction', required: true, state: 'done' },
      ]);
    expect(needs.map(n => `${n.typeName}${n.required ? '*' : ''}`)).toEqual(['CPR*', 'Driver licence*', 'First aid*', 'Police check']);
    expect(rightToWorkNeeded([{ credentialTypeId: 'right-to-work', problem: 'missing' }], [])).toBe(true);
    expect(rightToWorkNeeded([{ credentialTypeId: 'right-to-work', problem: 'unverified' }], [])).toBe(true);
    expect(rightToWorkNeeded([], [])).toBe(false);
  });
  it('works until it runs out or is stopped', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(linkState({ expiresAt: '2026-11-02T00:00:00Z', revokedAt: null }, now)).toBe('ok');
    expect(linkState({ expiresAt: '2026-10-31T00:00:00Z', revokedAt: null }, now)).toBe('expired');
    expect(linkState({ expiresAt: '2026-11-02T00:00:00Z', revokedAt: '2026-10-31T00:00:00Z' }, now)).toBe('stopped');
  });
  it('puts the link in the message instead of "send it to us"', () => {
    const m = askMessage({ first: 'Ana', business: 'Demo Care', items: [{ label: 'First aid', required: true }], note: null,
      linkLines: { email: 'You can send photos or files of these here, without signing in: https://x/upload/T', sms: 'Send them here: https://x/upload/T' } });
    expect(m.email).toContain('https://x/upload/T');
    expect(m.email).not.toContain('or bring them in');
    expect(m.sms).toContain('Send them here: https://x/upload/T');
  });
});

describe('upload links end to end', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const store = new MemoryStore();
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let ana: string, firstAid: string, police: string, token: string;
  const today = todayIn('Australia/Melbourne');

  const latestToken = async () => {
    const body = (await owner.query<{ body: string }>(
      `select body from notifications where template = 'upload_link' and worker_id = $1 and channel = 'email' order by created_at desc limit 1`, [ana])).rows[0].body;
    return /\/upload\/([A-Za-z0-9_-]{43})/.exec(body)![1];
  };

  beforeAll(async () => {
    db = await createTestDatabase('crop_upload_links');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('care','Demo Care'),('other','Other Co') returning id`);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`, [t.rows[0].id, t.rows[1].id]);
    for (const [sub, email] of [['owner', 'owner@x.com'], ['worker', 'w@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud', APP_URL: 'https://crop.example.com' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DOCUMENT_STORE).useValue(store).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    firstAid = (await http().post('/credential-types').set(as('owner')).send({ name: 'First aid', category: 'training', hasNumber: false, hasExpiry: true }).expect(201)).body.id;
    police = (await http().post('/credential-types').set(as('owner')).send({ name: 'Police check', category: 'check', hasNumber: true, hasExpiry: true }).expect(201)).body.id;
    await http().post('/credential-requirements').set(as('owner')).send({ credentialTypeId: firstAid, scope: 'role', role: 'Carer', severity: 'hard' }).expect(201);
    await http().post('/credential-requirements').set(as('owner')).send({ credentialTypeId: police, scope: 'role', role: 'Carer', severity: 'warning' }).expect(201);
    ana = (await http().post('/workers').set(as('owner')).send({ firstName: 'Ana', lastName: 'Example', email: 'ana@example.com', roles: ['Carer'] }).expect(201)).body.id;
    await http().put(`/workers/${ana}/right-to-work`).set(as('owner')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await owner?.end();
    await db?.drop();
  });

  it('the office sends a link; the message carries it', async () => {
    await http().post(`/workers/${ana}/upload-link`).set(as('worker')).send({}).expect(403);
    const r = await http().post(`/workers/${ana}/upload-link`).set(as('owner')).send({ note: 'Thanks!' }).expect(200);
    expect(r.body.sent).toEqual(['email']);
    token = await latestToken();
    const latest = (await http().get(`/workers/${ana}/upload-link`).set(as('owner')).expect(200)).body;
    expect(latest.link.state).toBe('ok');
    expect(latest.needs.map((n: { typeName: string }) => n.typeName)).toEqual(['First aid', 'Police check']);
    // Only the hash is stored.
    expect((await owner.query(`select count(*)::int as n from upload_links where encode(link_hash, 'escape') like '%' || $1 || '%'`, [token])).rows[0].n).toBe(0);
  });

  it('shows the person only their first name, the business and what is needed', async () => {
    const v = (await http().get(`/upload-links/${token}`).expect(200)).body;
    expect(v).toMatchObject({ business: 'Demo Care', firstName: 'Ana', state: 'ok' });
    expect(v.items.map((i: { typeName: string; required: boolean }) => [i.typeName, i.required])).toEqual([['First aid', true], ['Police check', false]]);
    expect(v.rightToWork).toEqual({ canSend: true, files: 0 });
    expect(JSON.stringify(v)).not.toContain('ana@example.com');
    await http().get('/upload-links/not-a-token').expect(404);
    await http().get(`/upload-links/${'A'.repeat(43)}`).expect(404);
  });

  it('takes a credential with its file; it waits for the office to check it', async () => {
    await http().post(`/upload-links/${token}/credentials`).field('credentialTypeId', firstAid).expect(400); // no file
    await http().post(`/upload-links/${token}/credentials`).field('credentialTypeId', firstAid).attach('file', PDF, 'fa.pdf').expect(400); // expiry needed
    await http().post(`/upload-links/${token}/credentials`).field('credentialTypeId', firstAid).field('expiryDate', addDays(today, -1)).attach('file', PDF, 'fa.pdf').expect(400);
    const v = (await http().post(`/upload-links/${token}/credentials`).field('credentialTypeId', firstAid).field('expiryDate', addDays(today, 300))
      .attach('file', PDF, 'first-aid.pdf').expect(200)).body;
    expect(v.items.find((i: { typeName: string }) => i.typeName === 'First aid').sent).toEqual({ files: 1 });
    // A second file goes on the same waiting credential.
    await http().post(`/upload-links/${token}/credentials`).field('credentialTypeId', firstAid).attach('file', PDF, 'back.pdf').expect(200);
    const w = (await http().get(`/workers/${ana}`).set(as('owner')).expect(200)).body;
    const fa = w.credentials.find((c: { typeName: string }) => c.typeName === 'First aid');
    expect(fa).toMatchObject({ verification: 'unverified', evidence: 'uploaded' });
    expect(fa.documents).toHaveLength(2);
    const office = (await owner.query(`select subject from notifications where template = 'link_credential_added'`)).rows;
    expect(office[0].subject).toBe('Ana Example sent First aid through their upload link');
  });

  it('refuses anything not asked for, and takes right to work proof', async () => {
    const other = (await http().post('/credential-types').set(as('owner')).send({ name: 'Forklift', category: 'licence', hasNumber: false, hasExpiry: false }).expect(201)).body.id;
    const r = await http().post(`/upload-links/${token}/credentials`).field('credentialTypeId', other).attach('file', PDF, 'x.pdf').expect(400);
    expect(r.body.message).toBe("That isn't one of the things asked for");
    const v = (await http().post(`/upload-links/${token}/right-to-work`).attach('file', PDF, 'passport.pdf').expect(200)).body;
    expect(v.rightToWork).toEqual({ canSend: true, files: 1 });
  });

  it('a newer link replaces the old one; the office can stop a link', async () => {
    await http().post(`/workers/${ana}/upload-link`).set(as('owner')).send({}).expect(200);
    const newer = await latestToken();
    expect((await http().get(`/upload-links/${token}`).expect(200)).body).toMatchObject({ state: 'stopped', items: [] });
    const old = await http().post(`/upload-links/${token}/right-to-work`).attach('file', PDF, 'p.pdf').expect(409);
    expect(old.body.message).toMatch(/replaced by a newer one/);
    await http().post(`/workers/${ana}/upload-link/stop`).set(as('owner')).expect(200);
    expect((await http().get(`/upload-links/${newer}`).expect(200)).body.state).toBe('stopped');
  });

  it("another business can't see or send for the person", async () => {
    await http().get(`/workers/${ana}/upload-link`).set(as('other')).expect(404);
    await http().post(`/workers/${ana}/upload-link`).set(as('other')).send({}).expect(404);
  });
});
