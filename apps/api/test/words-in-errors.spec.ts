import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { DEFAULT_WORDS, fillWords, hasWordTokens, makeWords, T } from '../src/terms/words.js';
import { startFakeIdp } from './fake-idp.js';

describe('word tokens in messages', () => {
  const venue = makeWords([
    { code: T.shift, singular: 'Job', plural: 'Jobs' }, { code: T.site, singular: 'Venue', plural: 'Venues' },
    { code: T.area, singular: 'Section', plural: 'Sections' }, { code: T.worker, singular: 'Team member', plural: 'Team' },
    { code: T.agency, singular: 'Supplier', plural: 'Suppliers' },
  ]);

  it('fills each form of a word', () => {
    expect(fillWords('{Shift} not found', venue)).toBe('Job not found');
    expect(fillWords('This {shift} is cancelled; {shifts}, {Shifts}', venue)).toBe('This job is cancelled; jobs, Jobs');
    expect(fillWords('Choose {a site}. {A worker} exists. Choose {an area}', venue)).toBe('Choose a venue. A team member exists. Choose a section');
    expect(fillWords('{Agencies} and {agencies} and {agency}', venue)).toBe('Suppliers and suppliers and supplier');
    expect(fillWords('Choose {an area}', DEFAULT_WORDS)).toBe('Choose an area');
    expect(fillWords('Choose {a area}')).toBe('Choose an area');
  });

  it('reads as before with CROP\'s words and leaves everything else alone', () => {
    expect(fillWords('This {shift} at this {site}')).toBe('This shift at this site');
    expect(fillWords('Ana {Example} said {nothing} at {} {shift', venue)).toBe('Ana {Example} said {nothing} at {} {shift');
    expect(fillWords('No tokens here', venue)).toBe('No tokens here');
    expect(hasWordTokens('This {shift}')).toBe(true);
    expect(hasWordTokens('Ana {Example}')).toBe(false);
  });
});

describe('API error messages use the business\'s words', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const missing = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    db = await createTestDatabase('crop_words_errors');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($2,'o@x.com','owner')`, [id('cafe'), id('other')]);
    await owner.end();
    for (const [sub, email] of [['admin', 'admin@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    await http().put('/terms').set(as('admin')).send({ terms: [
      { code: 1040, singular: 'Job', plural: 'Jobs' }, { code: 1020, singular: 'Venue', plural: 'Venues' }, { code: 1030, singular: 'Section', plural: 'Sections' },
      { code: 1050, singular: 'Certificate', plural: 'Certificates' }, { code: 1060, singular: 'Plant', plural: 'Plant' }, { code: 1070, singular: 'Stock item', plural: 'Stock' },
    ] }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('words "not found" and "choose" errors with them', async () => {
    const r = await http().get(`/shifts/${missing}`).set(as('admin')).expect(404);
    expect(r.body.message).toBe('Job not found');
    expect(r.body.statusCode).toBe(404);
    const c = await http().post('/shifts').set(as('admin'))
      .send({ facilityId: missing, role: 'Chef', startDate: '2031-03-03', endDate: '2031-03-03', startTime: '07:00', endTime: '15:00' }).expect(400);
    expect(c.body.message).toBe('Choose a venue');
    const site = (await http().post('/facilities').set(as('admin')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    const a = await http().post('/shifts').set(as('admin'))
      .send({ facilityId: site, areaId: missing, role: 'Chef', startDate: '2031-03-03', endDate: '2031-03-03', startTime: '07:00', endTime: '15:00' }).expect(400);
    expect(a.body.message).toBe('Choose a section at this venue');
  });

  it('words equipment, item and credential errors with them', async () => {
    expect((await http().get(`/equipment/${missing}`).set(as('admin')).expect(404)).body.message).toBe('Plant not found');
    expect((await http().post('/equipment').set(as('admin')).send({ name: 'Excavator 1' }).expect(400)).body.message).toBe('Choose a plant type');
    expect((await http().get(`/items/${missing}`).set(as('admin')).expect(404)).body.message).toBe('Stock item not found');
    const ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', email: 'ana@example.com' }).expect(201)).body.id;
    expect((await http().post(`/workers/${ana}/credentials`).set(as('admin')).send({ credentialTypeId: 'nope' }).expect(400)).body.message).toBe('Choose a certificate');
    expect((await http().post(`/workers/${ana}/credentials`).set(as('admin')).send({ credentialTypeId: missing }).expect(404)).body.message).toBe('Certificate type not found');
    expect((await http().get(`/equipment/${missing}`).set(as('other')).expect(404)).body.message).toBe('Equipment not found');
  });

  it('keeps CROP\'s words for a business that hasn\'t chosen its own', async () => {
    const r = await http().get(`/shifts/${missing}`).set(as('other')).expect(404);
    expect(r.body.message).toBe('Shift not found');
  });

  it('leaves messages without tokens as they are', async () => {
    const r = await http().get('/roster?from=2031-03-10&to=2031-03-03').set(as('admin')).expect(400);
    expect(r.body.message).toBe('The end date is before the start date');
  });
});
