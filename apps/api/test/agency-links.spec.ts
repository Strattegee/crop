import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { inviteState, linkStatusWords, orderProblem } from '../src/agencies/links.js';
import { catalogueCode, PACKS } from '../src/industry/packs.js';
import { startFakeIdp } from './fake-idp.js';

describe('agency links: rules', () => {
  it('gives every pack credential a catalogue code the database accepts, the same for the same name', () => {
    const byName = new Map<string, string>();
    const byCode = new Map<string, string>();
    for (const p of PACKS) for (const c of p.credentials) {
      expect(c.code).toMatch(/^[a-z]{2}\.[a-z0-9][a-z0-9-]{0,79}$/);
      if (byName.has(c.name)) expect(byName.get(c.name)).toBe(c.code);
      byName.set(c.name, c.code);
      if (byCode.has(c.code)) expect(byCode.get(c.code)).toBe(c.name);
      byCode.set(c.code, c.name);
    }
    expect(catalogueCode('Responsible Service of Alcohol (RSA)')).toBe('au.responsible-service-of-alcohol-rsa');
    expect(catalogueCode('First Aid (HLTAID011)')).toBe('au.first-aid-hltaid011');
  });

  it('works out invitation states and checks a new order', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const later = new Date('2026-11-02T00:00:00Z');
    expect(inviteState({ acceptedAt: null, cancelledAt: null, expiresAt: later }, now)).toBe('pending');
    expect(inviteState({ acceptedAt: null, cancelledAt: null, expiresAt: now }, now)).toBe('expired');
    expect(inviteState({ acceptedAt: now, cancelledAt: null, expiresAt: later }, now)).toBe('used');
    expect(inviteState({ acceptedAt: null, cancelledAt: now, expiresAt: later }, now)).toBe('cancelled');
    expect(orderProblem(['a', 'b'], ['b', 'a'])).toBeNull();
    expect(orderProblem(['a', 'a'], ['a', 'b'])).toBe('Each agency can appear only once');
    expect(orderProblem(['a'], ['a', 'b'])).toMatch(/changed/);
    expect(orderProblem('a', ['a'])).toBe('Give the agencies in order');
    expect(linkStatusWords('matching', 'employer', 'Caring For You')).toMatch(/Waiting for Caring For You to match/);
    expect(linkStatusWords('matching', 'agency', 'Bayside Hospital')).toMatch(/Match Bayside Hospital's requirements/);
  });
});

describe('agency links: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const invite = async (forName?: string) => (await http().post('/agency-links/invitations').set(as('emp')).send({ forName }).expect(201)).body;
  let firstLink: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_agency_links');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(
      `insert into tenants(slug, name) values ('bayside','Bayside Hospital'),('cfy','Caring For You'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(
      `insert into invitations(tenant_id, email, role) values ($1,'emp@x.com','owner'),($1,'empalloc@x.com','allocator'),
         ($2,'ag@x.com','admin'),($2,'agalloc@x.com','allocator'),($3,'nosy@x.com','owner')`, [ids.bayside, ids.cfy, ids.nosy]);
    for (const [sub, email] of [['emp', 'emp@x.com'], ['empalloc', 'empalloc@x.com'], ['ag', 'ag@x.com'], ['agalloc', 'agalloc@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    delete process.env.APP_URL;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lets only owners and admins make an invitation link; only its hash is stored', async () => {
    await http().post('/agency-links/invitations').set(as('empalloc')).send({}).expect(403);
    const inv = await invite('Caring For You');
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inv.link).toBeNull();
    const stored = (await owner.query('select link_hash, for_name from agency_invitations where id = $1', [inv.id])).rows[0];
    expect(stored.for_name).toBe('Caring For You');
    expect(Buffer.from(stored.link_hash).toString('base64url')).not.toBe(inv.token);
    const list = (await http().get('/agency-links').set(as('empalloc')).expect(200)).body;
    expect(list.invitations.map((i: { id: string; state: string }) => [i.id, i.state])).toEqual([[inv.id, 'pending']]);
    expect(JSON.stringify(list)).not.toContain(inv.token);
  });

  it('the agency previews and confirms; the employer can’t accept its own link', async () => {
    const inv = await invite();
    await http().get('/agency-invites/not-a-token').set(as('ag')).expect(404);
    await http().get(`/agency-invites/${'A'.repeat(43)}`).set(as('ag')).expect(404);
    const view = (await http().get(`/agency-invites/${inv.token}`).set(as('agalloc')).expect(200)).body;
    expect(view).toEqual({ employerName: 'Bayside Hospital', state: 'pending', ownBusiness: false, alreadyLinked: false, business: 'Caring For You' });
    expect((await http().get(`/agency-invites/${inv.token}`).set(as('emp')).expect(200)).body.ownBusiness).toBe(true);

    await http().post(`/agency-invites/${inv.token}/accept`).set(as('agalloc')).expect(403);
    const own = await http().post(`/agency-invites/${inv.token}/accept`).set(as('emp')).expect(409);
    expect(own.body.message).toMatch(/your own business/);

    const link = (await http().post(`/agency-invites/${inv.token}/accept`).set(as('ag')).expect(200)).body;
    expect(link).toMatchObject({ side: 'agency', otherName: 'Bayside Hospital', status: 'matching', preference: null });
    firstLink = link.connectionId;
    expect((await http().post(`/agency-invites/${inv.token}/accept`).set(as('ag')).expect(409)).body.message).toMatch(/already been used/);
    expect((await http().get(`/agency-invites/${inv.token}`).set(as('ag')).expect(200)).body).toMatchObject({ state: 'used', alreadyLinked: true });

    const emp = (await http().get('/agency-links').set(as('emp')).expect(200)).body;
    expect(emp.links).toHaveLength(1);
    expect(emp.links[0]).toMatchObject({ connectionId: firstLink, side: 'employer', otherName: 'Caring For You', status: 'matching', preference: 1, bookMode: 'automatic' });
    expect(emp.links[0].statusWords).toMatch(/Waiting for Caring For You/);
    expect(emp.invitations.find((i: { id: string }) => i.id === inv.id)).toMatchObject({ state: 'used', acceptedBy: 'Caring For You' });

    // A second link between the same two is refused.
    const again = await invite();
    expect((await http().post(`/agency-invites/${again.token}/accept`).set(as('ag')).expect(409)).body.message).toMatch(/already linked/);
  });

  it('a third business sees nothing of the link and can’t touch it', async () => {
    const nosy = (await http().get('/agency-links').set(as('nosy')).expect(200)).body;
    expect(nosy.links).toEqual([]);
    expect(nosy.invitations).toEqual([]);
    await http().get(`/agency-links/${firstLink}/events`).set(as('nosy')).expect(404);
    await http().post(`/agency-links/${firstLink}/end`).set(as('nosy')).send({}).expect(404);
    await http().patch(`/agency-links/${firstLink}`).set(as('nosy')).send({ bookMode: 'approve_first' }).expect(404);
    expect((await owner.query(`select count(*)::int as n from agency_events where tenant_id = $1`, [ids.nosy])).rows[0].n).toBe(0);
  });

  it('crop_app can’t make or end links except through the checked functions', async () => {
    const app = new Client({ connectionString: db.appUrl });
    await app.connect();
    try {
      await app.query('begin');
      await app.query(`select set_config('app.tenant_id', $1, true)`, [ids.nosy]);
      await expect(app.query(
        `insert into agency_connections(tenant_id, connection_id, side, other_tenant_id, other_name) values ($1, gen_random_uuid(), 'employer', $2, 'x')`,
        [ids.nosy, ids.cfy])).rejects.toThrow(/permission denied/);
      await app.query('rollback');
      await app.query('begin');
      await app.query(`select set_config('app.tenant_id', $1, true)`, [ids.cfy]);
      // No owner/admin actor set: refused.
      await expect(app.query('select app_agency_end($1, null)', [firstLink])).rejects.toThrow(/owners and administrators/);
      await app.query('rollback');
      await app.query('begin');
      await app.query(`select set_config('app.tenant_id', $1, true), set_config('app.actor_role', 'owner', true)`, [ids.nosy]);
      await expect(app.query('select app_agency_end($1, null)', [firstLink])).rejects.toThrow(/Link not found/);
      await app.query('rollback');
      await app.query('begin');
      await app.query(`select set_config('app.tenant_id', $1, true)`, [ids.cfy]);
      await expect(app.query(`delete from agency_events`)).rejects.toThrow(/permission denied/);
      await app.query('rollback');
      await app.query('begin');
      await app.query(`select set_config('app.tenant_id', $1, true)`, [ids.cfy]);
      await expect(app.query(`update agency_connections set status = 'active'`)).rejects.toThrow(/permission denied/);
      await app.query('rollback');
    } finally {
      await app.end();
    }
  });

  it('orders the employer’s agencies and sets how their people are booked', async () => {
    const inv = await invite('Nosy');
    const second = (await http().post(`/agency-invites/${inv.token}/accept`).set(as('nosy')).expect(200)).body.connectionId;
    let links = (await http().get('/agency-links').set(as('emp')).expect(200)).body.links;
    expect(links.map((l: { otherName: string; preference: number }) => [l.otherName, l.preference])).toEqual([['Caring For You', 1], ['Nosy Staffing', 2]]);

    await http().put('/agency-links/order').set(as('empalloc')).send({ connectionIds: [second, firstLink] }).expect(403);
    await http().put('/agency-links/order').set(as('emp')).send({ connectionIds: [second] }).expect(400);
    links = (await http().put('/agency-links/order').set(as('emp')).send({ connectionIds: [second, firstLink] }).expect(200)).body.links;
    expect(links.map((l: { otherName: string; preference: number }) => [l.otherName, l.preference])).toEqual([['Nosy Staffing', 1], ['Caring For You', 2]]);

    expect((await http().patch(`/agency-links/${firstLink}`).set(as('emp')).send({ bookMode: 'approve_first' }).expect(200)).body.bookMode).toBe('approve_first');
    await http().patch(`/agency-links/${firstLink}`).set(as('emp')).send({ bookMode: 'sometimes' }).expect(400);
    await http().patch(`/agency-links/${firstLink}`).set(as('ag')).send({ bookMode: 'automatic' }).expect(400);
    const events = (await http().get(`/agency-links/${firstLink}/events`).set(as('emp')).expect(200)).body;
    expect(events.map((e: { action: string }) => e.action)).toEqual(['book_mode_changed', 'linked']);
  });

  it('cancelled and expired links can’t be used', async () => {
    const a = await invite();
    await http().post(`/agency-links/invitations/${a.id}/cancel`).set(as('emp')).expect(200);
    await http().post(`/agency-links/invitations/${a.id}/cancel`).set(as('emp')).expect(400);
    await http().post(`/agency-links/invitations/${a.id}/cancel`).set(as('nosy')).expect(404);
    expect((await http().post(`/agency-invites/${a.token}/accept`).set(as('ag')).expect(409)).body.message).toMatch(/cancelled/);
    const b = await invite();
    await owner.query(`update agency_invitations set expires_at = now() - interval '1 minute' where id = $1`, [b.id]);
    expect((await http().get(`/agency-invites/${b.token}`).set(as('ag')).expect(200)).body.state).toBe('expired');
    expect((await http().post(`/agency-invites/${b.token}/accept`).set(as('ag')).expect(409)).body.message).toMatch(/expired/);
  });

  it('either side ends a link; both keep the history and can link again later', async () => {
    await http().post(`/agency-links/${firstLink}/end`).set(as('agalloc')).send({}).expect(403);
    const ended = (await http().post(`/agency-links/${firstLink}/end`).set(as('ag')).send({ reason: 'No longer supplying' }).expect(200)).body;
    expect(ended).toMatchObject({ status: 'ended', endedBySide: 'agency', endReason: 'No longer supplying', statusWords: 'Ended' });
    const emp = (await http().get('/agency-links').set(as('emp')).expect(200)).body.links;
    expect(emp.find((l: { connectionId: string }) => l.connectionId === firstLink)).toMatchObject({ status: 'ended', preference: null, endedBySide: 'agency' });
    expect((await http().post(`/agency-links/${firstLink}/end`).set(as('emp')).send({}).expect(409)).body.message).toMatch(/already ended/);
    for (const who of ['emp', 'ag']) {
      const ev = (await http().get(`/agency-links/${firstLink}/events`).set(as(who)).expect(200)).body;
      expect(ev[0]).toMatchObject({ action: 'ended', actorBusiness: 'Caring For You', detail: 'No longer supplying' });
    }
    const inv = await invite();
    expect((await http().post(`/agency-invites/${inv.token}/accept`).set(as('ag')).expect(200)).body.status).toBe('matching');
  });

  it('industry templates give credentials their catalogue code', async () => {
    await owner.query(`insert into credential_types(tenant_id, name, category) values ($1, 'Responsible Service of Alcohol (RSA)', 'licence')`, [ids.cfy]);
    await http().post('/industry-packs/hospitality/apply').set(as('ag')).expect(200);
    const types = (await http().get('/credential-types').set(as('ag')).expect(200)).body as Array<{ name: string; catalogueCode: string | null }>;
    expect(types.find(t => t.name === 'Responsible Service of Alcohol (RSA)')?.catalogueCode).toBe('au.responsible-service-of-alcohol-rsa');
    expect(types.find(t => t.name === 'Food Handler Training')?.catalogueCode).toBe('au.food-handler-training');
  });
});
