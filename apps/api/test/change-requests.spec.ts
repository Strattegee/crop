import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { requestArrivedEmail, requestDecidedEmail, requestProblem, requestSummary, shiftLine } from '../src/roster/change-requests.js';
import { startFakeIdp } from './fake-idp.js';

// A Monday well in the future, so the week is never history while these tests run.
const WEEK = '2031-03-03';

describe('change requests: plain words and checks', () => {
  it('describes each change', () => {
    expect(requestSummary({ kind: 'assign', workerName: 'Ana Example', reason: null })).toBe('Put Ana Example on the shift');
    expect(requestSummary({ kind: 'confirm', workerName: null, currentName: 'Ben Example', reason: null })).toBe('Confirm Ben Example (they have agreed)');
    expect(requestSummary({ kind: 'remove', workerName: null, currentName: 'Ben Example', reason: null })).toBe('Take Ben Example off the shift');
    expect(requestSummary({ kind: 'pulled_out', workerName: null, reason: null })).toBe('Record that the person on it pulled out');
    expect(requestSummary({ kind: 'cancel', workerName: null, reason: 'Function cancelled' })).toBe('Cancel the shift: Function cancelled');
    expect(requestSummary({ kind: 'other', workerName: null, reason: 'Start at 8 instead' })).toBe('Start at 8 instead');
  });

  it('refuses requests that could never be made', () => {
    const open = { status: 'open', equipmentOnly: false, hasPerson: false };
    expect(requestProblem('assign', open)).toBeNull();
    expect(requestProblem('remove', open)).toBe('Nobody is on this shift');
    expect(requestProblem('confirm', { ...open, status: 'booked', hasPerson: true })).toBe('There is nobody waiting to confirm on this shift');
    expect(requestProblem('assign', { ...open, hasPerson: true })).toMatch(/already on this shift/);
    expect(requestProblem('assign', { ...open, equipmentOnly: true })).toMatch(/equipment only/);
    expect(requestProblem('other', { ...open, status: 'cancelled' })).toBe('This shift is cancelled');
  });
});

describe('change requests: emails', () => {
  const r = {
    summary: 'Put Ana Example on the shift', reason: 'Swapped with Ben', kind: 'assign' as const, requestedByName: 'Sam Allocator',
    facilityName: 'Harbour Kitchen', areaName: 'Kitchen', role: 'Chef', localDate: '2031-03-04', localStart: '07:00', localEnd: '15:00',
    weekStart: '2031-03-03', facilityId: 'f1', shiftId: 's1',
  };

  it('describes the shift in plain words', () => {
    expect(shiftLine(r)).toBe('Tuesday 4 March, 07:00–15:00, Chef, Kitchen, Harbour Kitchen');
    expect(shiftLine({ ...r, areaName: null })).toBe('Tuesday 4 March, 07:00–15:00, Chef, Harbour Kitchen');
  });

  it('tells owners and admins what was asked, with a link to the shift', () => {
    const m = requestArrivedEmail(r, 'https://crop.test/');
    expect(m.subject).toBe('Change requested: Harbour Kitchen, Tuesday 4 March');
    expect(m.body).toContain('Sam Allocator has asked for a change to the published roster at Harbour Kitchen.');
    expect(m.body).toContain('Change: Put Ana Example on the shift');
    expect(m.body).toContain('Their note: Swapped with Ben');
    expect(m.body).toContain('https://crop.test/roster?week=2031-03-03&site=f1&shift=s1');
    // For a cancellation the reason is already the change, so it isn't repeated; without an app address there's no link.
    const c = requestArrivedEmail({ ...r, kind: 'cancel', summary: 'Cancel the shift: Quiet day', reason: 'Quiet day' }, '');
    expect(c.body).not.toContain('Their note');
    expect(c.body).toContain('open the shift on the roster in CROP');
  });

  it('tells the asker the outcome', () => {
    expect(requestDecidedEmail(r, 'approved', 'Olive Owner', null, '').body).toContain('Olive Owner approved it, and the change has been made.');
    expect(requestDecidedEmail({ ...r, kind: 'other' }, 'approved', 'Olive Owner', null, '').body).toContain('will make the change on the shift');
    const d = requestDecidedEmail(r, 'declined', 'Olive Owner', 'Ben is covering', 'https://crop.test');
    expect(d.subject).toBe('Change declined: Harbour Kitchen, Tuesday 4 March');
    expect(d.body).toContain('Olive Owner declined it, so the shift stays as it was.');
    expect(d.body).toContain('Their note: Ben is covering');
  });
});

describe('change requests on a published roster', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let otherTenant: string;
  let site: string, ana: string, ben: string, shiftA: string, shiftB: string, shiftC: string, draftShift: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_change_requests_api');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const tenantId = (await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe') returning id`)).rows[0].id;
    otherTenant = (await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('other','Other Business') returning id`)).rows[0].id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'owner@x.com','owner'),($1,'alloc@x.com','allocator'),($1,'alloc2@x.com','allocator'),($2,'else@x.com','owner')`, [tenantId, otherTenant]);
    await owner.end();
    for (const [sub, email] of [['owner', 'owner@x.com'], ['alloc', 'alloc@x.com'], ['alloc2', 'alloc2@x.com'], ['else', 'else@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: `${sub} Example` });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud', APP_URL: 'https://crop.test' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();

    site = (await http().post('/facilities').set(as('owner')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    const person = async (firstName: string) => {
      const id = (await http().post('/workers').set(as('owner')).send({ firstName, lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id;
      await http().put(`/workers/${id}/right-to-work`).set(as('owner')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${id}/right-to-work/verify`).set(as('owner')).send({}).expect(201);
      return id;
    };
    ana = await person('Ana');
    ben = await person('Ben');
    const made = await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Chef', startDate: WEEK, endDate: '2031-03-05', startTime: '07:00', endTime: '15:00' }).expect(201);
    [shiftA, shiftB, shiftC] = made.body.ids;
    await http().post(`/shifts/${shiftB}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);
    draftShift = (await http().post('/shifts').set(as('alloc'))
      .send({ facilityId: site, role: 'Chef', startDate: '2031-03-10', endDate: '2031-03-10', startTime: '07:00', endTime: '15:00' }).expect(201)).body.ids[0];
    await http().post('/roster/publish').set(as('alloc')).send({ weekStart: WEEK, facilityId: site }).expect(201);
    await http().patch('/settings').set(as('owner')).send({ publishedChanges: 'managers' }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  // Emails queued about one request (read as the table owner).
  const mail = async (id: string) => {
    const c = new Client({ connectionString: db.ownerUrl });
    await c.connect();
    try {
      return (await c.query<{ to: string; template: string; subject: string; body: string }>(
        `select to_address as to, template, subject, body from notifications where dedupe_key like $1 order by created_at, to_address`, [`change-request:${id}:%`])).rows;
    } finally {
      await c.end();
    }
  };

  const ask = (shift: string, body: Record<string, unknown>, who = 'alloc') => http().post(`/shifts/${shift}/change-requests`).set(as(who)).send(body);

  it('the week tells each person whether they can change it themselves', async () => {
    const [mine] = (await http().get(`/roster/weeks?weekStart=${WEEK}&facilityId=${site}`).set(as('alloc')).expect(200)).body;
    expect(mine.changeRefusal).toMatch(/only an owner or admin/);
    const [theirs] = (await http().get(`/roster/weeks?weekStart=${WEEK}&facilityId=${site}`).set(as('owner')).expect(200)).body;
    expect(theirs.changeRefusal).toBeNull();
  });

  it('only asks when the person can\'t make the change, and checks the request makes sense', async () => {
    expect((await ask(draftShift, { change: 'assign', workerId: ana }).expect(409)).body.message).toBe('You can make this change yourself.');
    expect((await ask(shiftA, { change: 'assign', workerId: ana }, 'owner').expect(409)).body.message).toBe('You can make this change yourself.');
    expect((await ask(shiftA, { change: 'teleport' }).expect(400)).body.message).toBe('Choose the change you need');
    expect((await ask(shiftA, { change: 'cancel' }).expect(400)).body.message).toBe('Reason is required');
    expect((await ask(shiftA, { change: 'remove' }).expect(409)).body.message).toBe('Nobody is on this shift');
    // Ben is on shift B, but shifts don't overlap, so he could still be put on A: check a real block instead.
    await ask(shiftA, { change: 'assign', workerId: '00000000-0000-4000-8000-000000000000' }).expect(400);
  });

  it('an allocator asks, an owner approves, and the change is made as the owner\'s and logged', async () => {
    const r = (await ask(shiftA, { change: 'assign', workerId: ana, reason: 'Ana swapped with Ben' }).expect(201)).body;
    expect(r).toMatchObject({ status: 'pending', summary: 'Put Ana Example on the shift', canDecide: false, canWithdraw: true, requestedByName: 'alloc Example' });
    // One waiting request per shift.
    expect((await ask(shiftA, { change: 'other', reason: 'Start later' }, 'alloc2').expect(409)).body.message).toBe('A change to this shift is already waiting for approval');
    const [week] = (await http().get(`/roster/weeks?weekStart=${WEEK}&facilityId=${site}`).set(as('owner')).expect(200)).body;
    expect(week.pendingRequests).toBe(1);
    const list = (await http().get(`/roster/change-requests?weekStart=2031-03-05`).set(as('owner')).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ canDecide: true, localDate: WEEK, localStart: '07:00' });
    // Without a week: every pending request (the Dashboard's count); other statuses still need a week.
    expect((await http().get('/roster/change-requests').set(as('owner')).expect(200)).body.map((x: { id: string }) => x.id)).toEqual([r.id]);
    await http().get('/roster/change-requests?status=all').set(as('owner')).expect(400);

    await http().post(`/change-requests/${r.id}/approve`).set(as('alloc')).send({}).expect(403);
    const ok = (await http().post(`/change-requests/${r.id}/approve`).set(as('owner')).send({}).expect(200)).body;
    expect(ok).toMatchObject({ status: 'approved', applied: true, decidedByName: 'owner Example' });
    const shift = (await http().get(`/shifts/${shiftA}`).set(as('alloc')).expect(200)).body;
    expect(shift).toMatchObject({ status: 'assigned', workerName: 'Ana Example' });
    const log = (await http().get(`/shifts/${shiftA}/history`).set(as('alloc')).expect(200)).body;
    expect(log.at(-1)).toMatchObject({ kind: 'assigned', afterPublish: true, actorName: 'owner Example' });
    await http().post(`/change-requests/${r.id}/approve`).set(as('owner')).send({}).expect(409);

    // The owner heard when it arrived; the allocator heard it was approved.
    const sent = await mail(r.id);
    expect(sent.map(m => [m.to, m.template])).toEqual([['owner@x.com', 'change_request'], ['alloc@x.com', 'change_request_decided']]);
    expect(sent[0].body).toContain('alloc Example has asked for a change');
    expect(sent[0].body).toContain('Change: Put Ana Example on the shift');
    expect(sent[0].body).toContain(`https://crop.test/roster?week=${WEEK}&site=${site}&shift=${shiftA}`);
    expect(sent[1].subject).toMatch(/^Change approved: Harbour Kitchen, Monday 3 March/);
    expect(sent[1].body).toContain('owner Example approved it, and the change has been made.');
  });

  it('approving a change that can no longer be made changes nothing and keeps the request waiting', async () => {
    const r = (await ask(shiftC, { change: 'assign', workerId: ana }).expect(201)).body;
    // Meanwhile the owner puts Ben on it directly.
    await http().post(`/shifts/${shiftC}/assign`).set(as('owner')).send({ workerId: ben }).expect(200);
    const fail = await http().post(`/change-requests/${r.id}/approve`).set(as('owner')).send({}).expect(409);
    expect(fail.body.message).toBe('Someone is already on this shift. Remove them first.');
    const [still] = (await http().get(`/shifts/${shiftC}/change-requests`).set(as('owner')).expect(200)).body;
    expect(still.status).toBe('pending');
    const declined = (await http().post(`/change-requests/${r.id}/decline`).set(as('owner')).send({ note: 'Ben is covering' }).expect(200)).body;
    expect(declined).toMatchObject({ status: 'declined', decisionNote: 'Ben is covering', canWithdraw: false });
    const [, told] = await mail(r.id);
    expect(told).toMatchObject({ to: 'alloc@x.com', template: 'change_request_decided' });
    expect(told.body).toContain('Put Ana Example on the shift');
    expect(told.body).toContain('Their note: Ben is covering');
  });

  it('confirming someone who has agreed', async () => {
    const r = (await ask(shiftB, { change: 'confirm' }).expect(201)).body;
    expect(r.summary).toBe('Confirm Ben Example (they have agreed)');
    await http().post(`/change-requests/${r.id}/approve`).set(as('owner')).send({}).expect(200);
    expect((await http().get(`/shifts/${shiftB}`).set(as('alloc')).expect(200)).body.status).toBe('booked');
    expect((await ask(shiftB, { change: 'confirm' }).expect(409)).body.message).toBe('There is nobody waiting to confirm on this shift');
  });

  it('pulled out, cancel and "something else" requests; withdrawing is for the asker or an owner', async () => {
    const pulled = (await ask(shiftB, { change: 'pulled_out' }).expect(201)).body;
    expect(pulled.summary).toBe('Record that Ben Example pulled out');
    await http().post(`/change-requests/${pulled.id}/withdraw`).set(as('alloc2')).expect(403);
    await http().post(`/change-requests/${pulled.id}/withdraw`).set(as('alloc')).expect(200);
    // Withdrawing your own request sends you nothing.
    expect((await mail(pulled.id)).map(m => m.template)).toEqual(['change_request']);

    const p2 = (await ask(shiftB, { change: 'pulled_out' }).expect(201)).body;
    await http().post(`/change-requests/${p2.id}/approve`).set(as('owner')).send({}).expect(200);
    expect((await http().get(`/shifts/${shiftB}`).set(as('alloc')).expect(200)).body).toMatchObject({ status: 'open', pulledOutName: 'Ben Example' });

    const other = (await ask(shiftB, { change: 'other', reason: 'Start at 8 instead' }).expect(201)).body;
    expect((await http().post(`/change-requests/${other.id}/approve`).set(as('owner')).send({}).expect(200)).body).toMatchObject({ applied: false, status: 'approved' });

    const cancel = (await ask(shiftB, { change: 'cancel', reason: 'Quiet day' }).expect(201)).body;
    await http().post(`/change-requests/${cancel.id}/approve`).set(as('owner')).send({}).expect(200);
    expect((await http().get(`/shifts/${shiftB}`).set(as('alloc')).expect(200)).body).toMatchObject({ status: 'cancelled', cancelledReason: 'Quiet day' });
    expect((await ask(shiftB, { change: 'other', reason: 'Bring it back' }).expect(409)).body.message).toBe('This shift is cancelled');
    const all = (await http().get(`/roster/change-requests?weekStart=${WEEK}&status=all`).set(as('alloc')).expect(200)).body;
    expect(all.map((x: { status: string }) => x.status).sort()).toEqual(['approved', 'approved', 'approved', 'approved', 'approved', 'declined', 'withdrawn']);
  });

  it('when changes are turned off, approving is refused with the reason and the request keeps waiting', async () => {
    const r = (await ask(shiftA, { change: 'remove' }).expect(201)).body;
    await http().patch('/settings').set(as('owner')).send({ publishedChanges: 'locked' }).expect(200);
    const fail = await http().post(`/change-requests/${r.id}/approve`).set(as('owner')).send({}).expect(409);
    expect(fail.body.message).toMatch(/changes are turned off/);
    await http().patch('/settings').set(as('owner')).send({ publishedChanges: 'managers' }).expect(200);
    await http().post(`/change-requests/${r.id}/approve`).set(as('owner')).send({}).expect(200);
    expect((await http().get(`/shifts/${shiftA}`).set(as('alloc')).expect(200)).body.status).toBe('open');
  });

  it('keeps each business\'s requests to itself', async () => {
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [otherTenant]);
      expect((await c.query('select count(*)::int as n from roster_change_requests')).rows[0].n).toBe(0);
      await expect(c.query('delete from roster_change_requests')).rejects.toThrow(/permission denied/);
      await c.query('rollback');
    } finally {
      await c.end();
    }
    const theirs = await http().get(`/roster/change-requests?weekStart=${WEEK}&status=all`).set(as('else')).expect(200);
    expect(theirs.body).toEqual([]);
  });
});
