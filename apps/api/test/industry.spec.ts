import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { PACKS } from '../src/industry/packs.js';
import { startFakeIdp } from './fake-idp.js';

describe('industry packs: content', () => {
  it('every pack is consistent: requirements and operator licences refer to credentials in the same pack', () => {
    for (const p of PACKS) {
      const names = new Set(p.credentials.map(c => c.name));
      expect(names.size, `${p.id}: duplicate credential`).toBe(p.credentials.length);
      for (const r of p.roles) for (const n of [...(r.must ?? []), ...(r.should ?? [])]) expect(names.has(n), `${p.id} ${r.name}: ${n}`).toBe(true);
      for (const e of p.equipmentTypes) if (e.operatorCredential) expect(names.has(e.operatorCredential), `${p.id} ${e.name}`).toBe(true);
      expect(new Set(p.roles.map(r => r.name)).size).toBe(p.roles.length);
      expect(new Set(p.shiftCodes.map(s => s.code)).size).toBe(p.shiftCodes.length);
      for (const s of p.shiftCodes) expect(s.start).not.toBe(s.end);
    }
  });

  it('a credential shared by several packs is described the same way in each', () => {
    const seen = new Map<string, string>();
    for (const p of PACKS) for (const c of p.credentials) {
      const sig = JSON.stringify([c.category, c.number, c.expiry]);
      if (seen.has(c.name)) expect(sig, c.name).toBe(seen.get(c.name));
      else seen.set(c.name, sig);
    }
  });
});

describe('industry packs: applying', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = await createTestDatabase('crop_industry_api');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('hire','Demo Hire'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'o@x.com','owner')`, [id('hire'), id('other')]);
    await owner.end();
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lists packs and applies construction, then labour hire, sharing credentials and never duplicating', async () => {
    const list = await http().get('/industry-packs').set(as('alloc')).expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(['healthcare', 'hospitality', 'construction', 'labour-hire']));
    await http().post('/industry-packs/construction/apply').set(as('alloc')).expect(403);
    await http().post('/industry-packs/nope/apply').set(as('admin')).expect(404);

    const c = await http().post('/industry-packs/construction/apply').set(as('admin')).expect(200);
    const pack = PACKS.find(p => p.id === 'construction')!;
    expect(c.body.added).toMatchObject({ roles: pack.roles.length, credentials: pack.credentials.length, equipmentTypes: pack.equipmentTypes.length, items: pack.items.length });

    const again = await http().post('/industry-packs/construction/apply').set(as('admin')).expect(200);
    expect(again.body.added).toEqual({ roles: 0, credentials: 0, requirements: 0, shiftCodes: 0, equipmentTypes: 0, items: 0, words: 0 });

    // Labour hire shares the forklift licence, White Card and others: they aren't added twice.
    const l = await http().post('/industry-packs/labour-hire/apply').set(as('admin')).expect(200);
    const lh = PACKS.find(p => p.id === 'labour-hire')!;
    const shared = lh.credentials.filter(x => pack.credentials.some(y => y.name === x.name)).length;
    expect(shared).toBeGreaterThan(2);
    expect(l.body.added.credentials).toBe(lh.credentials.length - shared);

    // Equipment types carry their operator licence, and roles show up.
    const types = await http().get('/equipment-types').set(as('alloc')).expect(200);
    const excavator = types.body.find((t: { name: string }) => t.name === 'Excavator (5 t)');
    expect(excavator.operatorCredentialTypeId ?? excavator.operatorCredentialType?.id).toBeTruthy();
    const roles = await http().get('/roles').set(as('alloc')).expect(200);
    expect(roles.body.map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining(['Excavator Operator', 'Forklift Driver']));
    const after = await http().get('/industry-packs').set(as('alloc')).expect(200);
    expect(after.body.filter((p: { appliedAt: string | null }) => p.appliedAt).map((p: { id: string }) => p.id).sort()).toEqual(['construction', 'labour-hire']);

    // Another business sees none of it.
    expect((await http().get('/roles').set(as('other')).expect(200)).body).toEqual([]);
    expect((await http().get('/industry-packs').set(as('other')).expect(200)).body.every((p: { appliedAt: unknown }) => p.appliedAt === null)).toBe(true);
  });

  it('uses the words from the first template applied, lets the business change them, and keeps them per business', async () => {
    const t = await http().get('/terms').set(as('alloc')).expect(200);
    const w = (code: number) => t.body.find((x: { code: number }) => x.code === code);
    expect(w(1050)).toMatchObject({ singular: 'Ticket', plural: 'Tickets', defaultSingular: 'Credential' }); // construction came first
    expect(w(1060)).toMatchObject({ singular: 'Plant' });
    await http().put('/terms').set(as('alloc')).send({ terms: [{ code: 1010, singular: 'Operator' }] }).expect(403);
    await http().put('/terms').set(as('admin')).send({ terms: [{ code: 9999, singular: 'X' }] }).expect(400);
    const saved = await http().put('/terms').set(as('admin')).send({ terms: [{ code: 1010, singular: 'Operator', plural: 'Operators' }, { code: 1050, singular: '' }] }).expect(200);
    expect(saved.body.find((x: { code: number }) => x.code === 1010)).toMatchObject({ singular: 'Operator', plural: 'Operators' });
    expect(saved.body.find((x: { code: number }) => x.code === 1050)).toMatchObject({ singular: 'Credential' }); // reset to default
    const theirs = await http().get('/terms').set(as('other')).expect(200);
    expect(theirs.body.find((x: { code: number }) => x.code === 1010)).toMatchObject({ singular: 'Worker' });
  });

  it('a business can add its own role', async () => {
    await http().post('/roles').set(as('admin')).send({ name: 'Concreter', area: 'Site' }).expect(201);
    await http().post('/roles').set(as('admin')).send({ name: 'concreter' }).expect(400);
  });
});
