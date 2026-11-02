import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { ClientConfirmations } from '../src/clients/client-orders.controller.js';
import { clientConfirmationEmail, clientShiftStage, orderPlaceProblem, orderSummary, parseOrder } from '../src/clients/client-orders.js';
import { makeWords } from '../src/terms/words.js';
import { startFakeIdp } from './fake-idp.js';

const CLIENT = '11111111-1111-4111-8111-111111111111';

describe('client orders: rules (David, 2 Nov)', () => {
  it('checks the order’s own fields', () => {
    expect(parseOrder({ clientId: CLIENT, requestedByName: ' Pat Ward ', requestedByEmail: 'Pat@Bayside.Example', channel: 'phone' })).toEqual({
      clientId: CLIENT, channel: 'phone', requestedByName: 'Pat Ward', requestedByEmail: 'pat@bayside.example', requestedByPhone: null,
      clientReference: null, orderNotes: null, confirmToClient: true,
    });
    expect(parseOrder({ clientId: CLIENT, requestedByName: 'Pat' }).channel).toBe('other');
    expect(parseOrder({ clientId: CLIENT, requestedByName: 'Pat', confirmToClient: false }).confirmToClient).toBe(false);
    expect(() => parseOrder({ requestedByName: 'Pat' })).toThrow('Choose {a client}');
    expect(() => parseOrder({ clientId: CLIENT })).toThrow('Who asked is required');
    expect(() => parseOrder({ clientId: CLIENT, requestedByName: 'Pat', channel: 'fax' })).toThrow(/email, phone, portal or other/);
    expect(() => parseOrder({ clientId: CLIENT, requestedByName: 'Pat', requestedByEmail: 'nope' })).toThrow('Their email must be an email address');
    expect(() => parseOrder({ clientId: CLIENT, requestedByName: 'Pat', clientReference: 'x'.repeat(61) })).toThrow(/Their reference is too long/);
  });

  it('says why an order can’t go on that client and site', () => {
    const site = { clientId: CLIENT, active: true };
    expect(orderPlaceProblem({ status: 'active' }, site, CLIENT)).toBeNull();
    expect(orderPlaceProblem(undefined, site, CLIENT)).toBe('Choose {a client}');
    expect(orderPlaceProblem({ status: 'on_hold' }, site, CLIENT)).toMatch(/isn’t active/);
    expect(orderPlaceProblem({ status: 'active' }, undefined, CLIENT)).toBe('Choose {a site}');
    expect(orderPlaceProblem({ status: 'active' }, { clientId: null, active: true }, CLIENT)).toMatch(/doesn’t belong to this \{client\}/);
    expect(orderPlaceProblem({ status: 'active' }, { ...site, active: false }, CLIENT)).toMatch(/switched off/);
  });

  it('writes the client’s email with the person’s name and the shift, in the business’s words', () => {
    const facts = { contactName: 'Pat Ward', businessName: 'Caring Example', personName: 'Sarah Example', role: 'Registered Nurse',
      siteName: 'Bayside Hospital', areaName: 'Ward 4', localDate: '2026-11-10', localStart: '07:00', localEnd: '15:30', clientReference: 'PO-77' };
    const { subject, body } = clientConfirmationEmail(facts);
    expect(subject).toBe('Booked: Sarah Example for Ward 4, Bayside Hospital, Tue 10 Nov 07:00–15:30 (your ref PO-77)');
    expect(body).toContain('Hello Pat Ward,');
    expect(body).toContain('Sarah Example (Registered Nurse) is booked for the shift you asked Caring Example for:');
    expect(body).toContain('Site: Bayside Hospital\nArea: Ward 4\nWhen: Tue 10 Nov 07:00–15:30\nYour reference: PO-77');
    expect(body).toContain('Thanks,\nCaring Example');
    const jobs = clientConfirmationEmail({ ...facts, areaName: null, clientReference: null },
      makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }, { code: 1020, singular: 'Facility', plural: 'Facilities' }]));
    expect(jobs.subject).toBe('Booked: Sarah Example for Bayside Hospital, Tue 10 Nov 07:00–15:30');
    expect(jobs.body).toContain('booked for the job you asked');
    expect(jobs.body).toContain('Facility: Bayside Hospital\nWhen:');
    expect(jobs.body).not.toContain('reference');
  });

  it('sums up an order in a line', () => {
    expect(orderSummary({ total: 3, booked: 2, assigned: 0, open: 1, cancelled: 0 })).toBe('2 of 3 filled');
    expect(orderSummary({ total: 4, booked: 1, assigned: 1, open: 1, cancelled: 1 })).toBe('1 of 3 filled · 1 waiting to confirm · 1 cancelled');
    expect(orderSummary({ total: 2, booked: 2, assigned: 0, open: 0, cancelled: 0 })).toBe('All 2 shifts filled');
    expect(orderSummary({ total: 2, booked: 0, assigned: 0, open: 0, cancelled: 2 })).toBe('Cancelled');
    expect(clientShiftStage({ status: 'open', offersPending: 0 })).toBe('open');
    expect(clientShiftStage({ status: 'open', offersPending: 2 })).toBe('offered');
    expect(clientShiftStage({ status: 'assigned', offersPending: 0 })).toBe('assigned');
    expect(clientShiftStage({ status: 'booked', offersPending: 0 })).toBe('booked');
  });
});

describe('client orders: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  // Dates ahead of today, so the shifts haven't started.
  const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const confirmations = () => app.get(ClientConfirmations);
  const emails = async () => (await owner.query<{ to_address: string; subject: string; body: string }>(
    `select to_address, subject, body from notifications where template = 'client_booking_confirmed' order by created_at`)).rows;
  const order = (extra: Record<string, unknown> = {}) => ({
    clientId: ids.bayside, facilityId: ids.campus, areaId: ids.ward, role: 'Nurse', date: ahead(3), startTime: '07:00', endTime: '15:30',
    breakMinutes: 30, quantity: 1, channel: 'email', requestedByName: 'Pat Ward', requestedByEmail: 'pat@bayside.example', clientReference: 'PO-77', ...extra,
  });

  beforeAll(async () => {
    db = await createTestDatabase('crop_client_orders');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('c4u','Caring Example'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'nosy@x.com','owner')`, [ids.c4u, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    ids.bayside = (await http().post('/clients').set(as('admin')).send({ name: 'Bayside Health' }).expect(201)).body.id;
    ids.hill = (await http().post('/clients').set(as('admin')).send({ name: 'Hillview Care' }).expect(201)).body.id;
    ids.campus = (await http().post('/facilities').set(as('admin')).send({ name: 'Bayside Campus', state: 'VIC', clientId: ids.bayside }).expect(201)).body.id;
    ids.ward = (await http().post(`/facilities/${ids.campus}/areas`).set(as('admin')).send({ name: 'Ward 4' }).expect(201)).body.id;
    ids.hillSite = (await http().post('/facilities').set(as('admin')).send({ name: 'Hillview House', state: 'VIC', clientId: ids.hill }).expect(201)).body.id;
    ids.office = (await http().post('/facilities').set(as('admin')).send({ name: 'Head Office', state: 'VIC' }).expect(201)).body.id;
    const person = async (firstName: string) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Nurse'], email: `${firstName.toLowerCase()}@example.com` }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      await http().post(`/workers/${w}/employment`).set(as('admin')).send({ employmentType: 'casual', startsOn: '2026-01-01' }).expect(201);
      return w;
    };
    ids.sarah = await person('Sarah');
    ids.tom = await person('Tom');
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('makes the order’s shifts at the client’s site, linked to the order', async () => {
    await http().post('/client-orders').set(as('worker')).send(order()).expect(403);
    const r = (await http().post('/client-orders').set(as('alloc')).send(order({ quantity: 2, startDate: ahead(3), endDate: ahead(4), date: undefined })).expect(201)).body;
    expect(r.created).toBe(4);
    expect(r.ids).toHaveLength(4);
    ids.order = r.orderId;
    const rows = (await owner.query<{ client_order_id: string; role: string; break_minutes: number }>('select client_order_id, role, break_minutes from shifts where id = any($1)', [r.ids])).rows;
    expect(rows.every(x => x.client_order_id === r.orderId && x.role === 'Nurse' && x.break_minutes === 30)).toBe(true);
    // Who made it is in the shift log and the audit log.
    expect((await owner.query(`select 1 from shift_changes where shift_id = any($1)`, [r.ids])).rowCount).toBeGreaterThan(0);
    expect((await owner.query(`select 1 from audit_log where table_name = 'client_orders' and row_id = $1`, [r.orderId])).rowCount).toBe(1);
  });

  it('refuses a site that isn’t the client’s, an inactive client and bad fields', async () => {
    const wrong = await http().post('/client-orders').set(as('alloc')).send(order({ facilityId: ids.hillSite, areaId: undefined })).expect(400);
    expect(wrong.body.message).toBe('That site doesn’t belong to this client. Choose one of their sites.');
    await http().post('/client-orders').set(as('alloc')).send(order({ facilityId: ids.office, areaId: undefined })).expect(400);
    const noName = await http().post('/client-orders').set(as('alloc')).send(order({ requestedByName: '' })).expect(400);
    expect(noName.body.message).toBe('Who asked is required');
    const hold = (await http().post('/clients').set(as('admin')).send({ name: 'Paused Care' }).expect(201)).body.id;
    const holdSite = (await http().post('/facilities').set(as('admin')).send({ name: 'Paused House', state: 'VIC', clientId: hold }).expect(201)).body.id;
    await http().patch(`/clients/${hold}`).set(as('admin')).send({ status: 'on_hold' }).expect(200);
    const paused = await http().post('/client-orders').set(as('alloc')).send(order({ clientId: hold, facilityId: holdSite, areaId: undefined })).expect(400);
    expect(paused.body.message).toMatch(/isn’t active/);
    // Nothing was made by the refused orders.
    expect((await owner.query('select count(*)::int as n from client_orders')).rows[0].n).toBe(1);
  });

  it('lists recent orders with counts and a summary line, for this business only', async () => {
    const list = (await http().get('/client-orders').set(as('alloc')).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: ids.order, clientName: 'Bayside Health', facilityName: 'Bayside Campus', requestedByName: 'Pat Ward',
      channel: 'email', channelWords: 'Email', clientReference: 'PO-77', total: 4, open: 4, booked: 0, summary: '0 of 4 filled' });
    expect((await http().get('/client-orders').set(as('nosy')).expect(200)).body).toEqual([]);
    await http().get('/client-orders').set(as('worker')).expect(403);
    await http().get('/client-orders?days=0').set(as('alloc')).expect(400);
    // Row-level security: the other business can't see the rows at all.
    const nosy = await http().get('/allocations/client-shifts').set(as('nosy')).expect(200);
    expect(nosy.body.shifts).toEqual([]);
  });

  it('lists client shifts to fill and counts them for the menu', async () => {
    // A shift at the business's own office isn't a client shift.
    await http().post('/shifts').set(as('alloc')).send({ facilityId: ids.office, role: 'Admin', date: ahead(3), startTime: '09:00', endTime: '17:00' }).expect(201);
    const r = (await http().get('/allocations/client-shifts').set(as('alloc')).expect(200)).body;
    expect(r.shifts).toHaveLength(4);
    expect(r.counts).toEqual({ open: 4, offered: 0, assigned: 0, booked: 0 });
    expect(r.shifts[0]).toMatchObject({ clientName: 'Bayside Health', facilityName: 'Bayside Campus', areaName: 'Ward 4', orderId: ids.order,
      clientReference: 'PO-77', requestedByName: 'Pat Ward', stage: 'open', localStart: '07:00', localEnd: '15:30' });
    expect((await http().get(`/allocations/client-shifts?clientId=${ids.hill}`).set(as('alloc')).expect(200)).body.shifts).toEqual([]);
    const s = (await http().get('/allocations/summary').set(as('alloc')).expect(200)).body;
    expect(s).toMatchObject({ agencyLinks: 0, open: 0, hasClients: true, clientShiftsOpen: 4 });
    expect((await http().get('/allocations/summary').set(as('nosy')).expect(200)).body).toMatchObject({ hasClients: false, clientShiftsOpen: 0 });
  });

  it('emails the client once when a shift is booked (assign and confirm), with the person’s name', async () => {
    const [first] = (await http().get('/allocations/client-shifts').set(as('alloc')).expect(200)).body.shifts as { id: string }[];
    await http().post(`/shifts/${first.id}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    expect(await confirmations().runOnce()).toBe(0); // allocated, not yet booked
    await http().post(`/shifts/${first.id}/confirm`).set(as('alloc')).expect(200);
    expect(await confirmations().runOnce()).toBe(1);
    expect(await confirmations().runOnce()).toBe(0);
    const sent = await emails();
    expect(sent).toHaveLength(1);
    expect(sent[0].to_address).toBe('pat@bayside.example');
    expect(sent[0].subject).toContain('Booked: Sarah Example for Ward 4, Bayside Campus');
    expect(sent[0].body).toContain('Sarah Example (Nurse) is booked for the shift you asked Caring Example for');
    expect(sent[0].body).toContain('Your reference: PO-77');
    const c = (await owner.query<{ notification_id: string | null }>('select notification_id from client_order_confirmations where shift_id = $1', [first.id])).rows;
    expect(c).toHaveLength(1);
    expect(c[0].notification_id).not.toBeNull();
    const list = (await http().get('/client-orders').set(as('alloc')).expect(200)).body;
    expect(list[0]).toMatchObject({ booked: 1, summary: '1 of 4 filled', confirmationsSent: 1 });
  });

  it('emails the client when an offer is accepted too', async () => {
    const shifts = (await http().get('/allocations/client-shifts').set(as('alloc')).expect(200)).body.shifts as { id: string; stage: string; localDate: string }[];
    // Tom can't be on the same times as Sarah's day, so take one on the other day.
    const target = shifts.filter(s => s.stage === 'open').at(-1)!;
    await http().post(`/shifts/${target.id}/offers`).set(as('alloc')).send({ workerIds: [ids.tom], notify: false }).expect(201);
    const offered = (await http().get('/allocations/client-shifts').set(as('alloc')).expect(200)).body;
    expect(offered.counts.offered).toBe(1);
    const offer = (await http().get(`/shifts/${target.id}/bank-fill?everyone=true`).set(as('alloc')).expect(200)).body.offers[0].id;
    await http().post(`/offers/${offer}/accept`).set(as('alloc')).expect(200);
    expect(await confirmations().runOnce()).toBe(1);
    const sent = await emails();
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toContain('Tom Example (Nurse) is booked');
  });

  it('sends nothing when the order said not to, or has no email', async () => {
    const quiet = (await http().post('/client-orders').set(as('alloc')).send(order({ date: ahead(6), confirmToClient: false })).expect(201)).body.ids[0];
    const noEmail = (await http().post('/client-orders').set(as('alloc')).send(order({ date: ahead(7), requestedByEmail: undefined, channel: 'phone', requestedByPhone: '03 9000 0000' })).expect(201)).body.ids[0];
    for (const s of [quiet, noEmail]) {
      await http().post(`/shifts/${s}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
      await http().post(`/shifts/${s}/confirm`).set(as('alloc')).expect(200);
    }
    expect(await confirmations().runOnce()).toBe(0);
    expect(await emails()).toHaveLength(2);
  });
});
