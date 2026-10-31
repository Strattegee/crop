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
import { cardFacts } from '../src/workforce/person-card.js';
import { startFakeIdp } from './fake-idp.js';

describe('employee card facts (David, 31 Oct)', () => {
  const today = '2026-10-31';
  it('lists verified, current credentials as badges and finds the soonest expiry', () => {
    const f = cardFacts([
      { typeName: 'Police check', expiryDate: '2027-03-01', verification: 'verified' },
      { typeName: 'First aid', expiryDate: '2026-12-01', verification: 'verified' },
      { typeName: 'Forklift licence', expiryDate: '2026-10-01', verification: 'verified' }, // run out
      { typeName: 'Driver licence', expiryDate: null, verification: 'verified' },
      { typeName: 'Food handling', expiryDate: '2026-11-15', verification: 'unverified' }, // not checked: no badge, no expiry
    ], null, today);
    expect(f).toEqual({ held: ['Driver licence', 'First aid', 'Police check'], nextExpiry: { name: 'First aid', date: '2026-12-01' }, toCheck: 1 });
  });
  it('counts the visa when it runs out first, and nothing when nothing is recorded', () => {
    expect(cardFacts([{ typeName: 'First aid', expiryDate: '2027-01-01', verification: 'verified' }], '2026-11-20', today).nextExpiry)
      .toEqual({ name: 'Visa', date: '2026-11-20' });
    expect(cardFacts([], null, today)).toEqual({ held: [], nextExpiry: null, toCheck: 0 });
  });
});

describe('employee card on the worker endpoints', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let ana: string, ben: string, site: string;
  const today = todayIn('Australia/Melbourne');
  const nextWeek = addDays(today, 7);

  beforeAll(async () => {
    db = await createTestDatabase('crop_person_card');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('card','Demo Card') returning id`);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner')`, [t.rows[0].id]);
    await owner.end();
    idp.addUser({ sub: 'owner', email: 'owner@x.com', email_verified: true });
    tok.owner = await idp.token('owner', { expiresIn: '1h' });
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    site = (await http().post('/facilities').set(as('owner')).send({ name: 'Bayside House', state: 'VIC' }).expect(201)).body.id;
    const person = async (firstName: string) => {
      const id = (await http().post('/workers').set(as('owner')).send({ firstName, lastName: 'Example', roles: ['Carer'] }).expect(201)).body.id as string;
      await http().put(`/workers/${id}/right-to-work`).set(as('owner')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${id}/right-to-work/verify`).set(as('owner')).send({}).expect(201);
      return id;
    };
    ana = await person('Ana');
    ben = await person('Ben');
    const type = (await http().post('/credential-types').set(as('owner')).send({ name: 'First aid', category: 'training', hasExpiry: true, hasNumber: false, needsEvidence: false }).expect(201)).body.id;
    const c = (await http().post(`/workers/${ana}/credentials`).set(as('owner')).send({ credentialTypeId: type, expiryDate: addDays(today, 100) }).expect(201)).body.id;
    await http().post(`/workers/${ana}/credentials/${c}/verify`).set(as('owner')).send({}).expect(201);
    await http().post(`/workers/${ana}/employment`).set(as('owner')).send({ employmentType: 'part_time', contractedHours: 24, startsOn: today }).expect(201);
    const [shift] = (await http().post('/shifts').set(as('owner'))
      .send({ facilityId: site, role: 'Carer', date: nextWeek, startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids;
    await http().post(`/shifts/${shift}/assign`).set(as('owner')).send({ workerId: ana }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('the list and the person carry the card', async () => {
    const list = (await http().get('/workers').set(as('owner')).expect(200)).body as Array<{ id: string; card: Record<string, unknown> }>;
    const a = list.find(w => w.id === ana)!.card;
    expect(a).toMatchObject({ held: ['First aid'], nextExpiry: { name: 'First aid', date: addDays(today, 100) }, toCheck: 0,
      employmentType: 'part_time', contractedHours: 24 });
    expect((a.nextShift as { label: string }).label).toMatch(/07:00 · Bayside House$/);
    expect(list.find(w => w.id === ben)!.card).toMatchObject({ held: [], nextExpiry: null, nextShift: null, employmentType: null, weekHours: 0 });
    const one = (await http().get(`/workers/${ana}`).set(as('owner')).expect(200)).body;
    expect(one.card).toEqual(a);
  });

  it("lists one person's shifts", async () => {
    const mine = (await http().get(`/shifts?from=${today}&to=${addDays(today, 14)}&workerId=${ana}`).set(as('owner')).expect(200)).body;
    expect(mine).toHaveLength(1);
    expect((await http().get(`/shifts?from=${today}&to=${addDays(today, 14)}&workerId=${ben}`).set(as('owner')).expect(200)).body).toEqual([]);
  });
});
