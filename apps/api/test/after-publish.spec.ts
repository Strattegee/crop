import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { publishedChangesLabel } from '../src/roster/publishing.js';
import { startFakeIdp } from './fake-idp.js';

// A Monday well in the future, so the week is never history while these tests run.
const WEEK = '2031-03-03';

describe('after publishing: who can change a live week', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let tenantId: string;
  let site: string, ana: string, ben: string, shiftA: string, shiftB: string, draftShift: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_after_publish_api');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    tenantId = (await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe') returning id`)).rows[0].id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator')`, [tenantId]);
    await owner.end();
    for (const [sub, email] of [['owner', 'owner@x.com'], ['admin', 'admin@x.com'], ['alloc', 'alloc@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();

    site = (await http().post('/facilities').set(as('admin')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    const person = async (firstName: string) => {
      const id = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id;
      await http().put(`/workers/${id}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${id}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      return id;
    };
    ana = await person('Ana');
    ben = await person('Ben');
    const made = await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Chef', startDate: WEEK, endDate: '2031-03-04', startTime: '07:00', endTime: '15:00' }).expect(201);
    [shiftA, shiftB] = made.body.ids;
    draftShift = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Chef', startDate: '2031-03-10', endDate: '2031-03-10', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: WEEK, facilityId: site }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  const setRule = (rule: string, who = 'owner') => http().patch('/settings').set(as(who)).send({ publishedChanges: rule });

  it('describes each rule in plain words', () => {
    expect(publishedChangesLabel('managers')).toBe('Only owners and admins can make changes');
  });

  it('is open by default: anyone in the office can change a live week, and it is logged', async () => {
    expect((await http().get('/settings').set(as('alloc')).expect(200)).body.publishedChanges).toBe('open');
    await http().post(`/shifts/${shiftA}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    const log = (await http().get(`/shifts/${shiftA}/history`).set(as('alloc')).expect(200)).body;
    expect(log.at(-1)).toMatchObject({ kind: 'assigned', afterPublish: true });
  });

  it('only owners and admins choose the rule, and only from the three choices', async () => {
    await setRule('managers', 'alloc').expect(403);
    const bad = await setRule('sometimes').expect(400);
    expect(bad.body.message).toBe('Choose what can change after a roster is published');
    const ok = await setRule('managers').expect(200);
    expect(ok.body.publishedChanges).toBe('managers');
  });

  it('managers: allocators are refused on a live week, owners and admins are not, drafts are untouched', async () => {
    const r = await http().post(`/shifts/${shiftA}/unassign`).set(as('alloc')).send({}).expect(409);
    expect(r.body.message).toBe('This week\'s roster has been published, so only an owner or admin can change it.');
    // Nothing was changed by the refused request.
    expect((await http().get(`/shifts/${shiftA}/history`).set(as('alloc')).expect(200)).body.at(-1).kind).toBe('assigned');
    await http().post(`/shifts/${shiftB}/cancel`).set(as('alloc')).send({ reason: 'Quiet day' }).expect(409);
    await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Chef', startDate: '2031-03-05', endDate: '2031-03-05', startTime: '07:00', endTime: '15:00' }).expect(409);
    // Offering would lead to a change, so it is refused up front.
    const offer = await http().post(`/shifts/${shiftB}/offers`).set(as('alloc')).send({ workerIds: [ben], notify: false }).expect(409);
    expect(offer.body.message).toMatch(/only an owner or admin/);

    await http().post(`/shifts/${shiftA}/confirm`).set(as('admin')).expect(200);
    await http().post(`/shifts/${shiftB}/assign`).set(as('owner')).send({ workerId: ben }).expect(200);
    // A week that hasn't been published is still a draft anyone in the office can change.
    await http().post(`/shifts/${draftShift}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
  });

  it('locked: nobody in the office can change a live week until it is turned back on', async () => {
    await setRule('locked').expect(200);
    const r = await http().post(`/shifts/${shiftB}/unassign`).set(as('owner')).send({}).expect(409);
    expect(r.body.message).toBe('This week\'s roster has been published and changes are turned off. An owner or admin can turn them back on in Settings.');
    await http().patch(`/shifts/${shiftA}`).set(as('admin')).send({ notes: 'Deliveries at 9' }).expect(409);
    await http().post(`/shifts/${draftShift}/unassign`).set(as('alloc')).send({}).expect(200);
    await setRule('open').expect(200);
    await http().post(`/shifts/${shiftB}/unassign`).set(as('alloc')).send({}).expect(200);
  });

  it('replies through offer links count as allowed unless changes are turned off; system changes always are', async () => {
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    const refusal = async (rule: string, via: string | null, role: string | null) => {
      await c.query('begin');
      try {
        await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
        await c.query(`update tenant_settings set published_changes = $1`, [rule]);
        if (via) await c.query(`select set_config('app.actor_via', $1, true)`, [via]);
        if (role) await c.query(`select set_config('app.actor_role', $1, true)`, [role]);
        return (await c.query<{ r: string | null }>(`select app_roster_change_refusal($1, $2) as r`, [site, WEEK])).rows[0].r;
      } finally {
        await c.query('rollback');
      }
    };
    try {
      expect(await refusal('managers', 'link', null)).toBeNull();
      expect(await refusal('locked', 'link', null)).toBe('This roster can\'t be changed now. Please contact the office.');
      expect(await refusal('locked', null, null)).toBeNull();
      expect(await refusal('managers', 'office', null)).toMatch(/only an owner or admin/);
      expect(await refusal('managers', 'office', 'admin')).toBeNull();
    } finally {
      await c.end();
    }
  });
});
