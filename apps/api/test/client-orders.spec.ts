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
import { clientChangeEmail, clientConfirmRefusal, contactProblem, parseContact, whoAsked, clientConfirmationEmail, clientShiftStage, orderPlaceProblem, orderSummary, parseOrder, waitsForClient } from '../src/clients/client-orders.js';
import { makeWords } from '../src/terms/words.js';
import { startFakeIdp } from './fake-idp.js';

const CLIENT = '11111111-1111-4111-8111-111111111111';

describe('client orders: rules (David, 2 Nov)', () => {
  it('checks the order’s own fields', () => {
    expect(parseOrder({ clientId: CLIENT, requestedByName: ' Pat Ward ', requestedByEmail: 'Pat@Bayside.Example', channel: 'phone' })).toEqual({
      clientId: CLIENT, channel: 'phone', requestedByName: 'Pat Ward', requestedByEmail: 'pat@bayside.example', requestedByPhone: null,
      clientReference: null, orderNotes: null, confirmToClient: true, contactId: null, saveContact: false, customerRequestId: null,
    });
    expect(parseOrder({ clientId: CLIENT, requestedByName: 'Pat' }).channel).toBe('other');
    expect(parseOrder({ clientId: CLIENT, requestedByName: 'Pat', confirmToClient: false }).confirmToClient).toBe(false);
    expect(() => parseOrder({ requestedByName: 'Pat' })).toThrow('Choose {a client}');
    expect(() => parseOrder({ clientId: CLIENT })).toThrow('Who asked is required');
    // A saved contact stands in for who asked; saving a contact is only for typed details.
    expect(parseOrder({ clientId: CLIENT, contactId: CLIENT, saveContact: true })).toMatchObject({ contactId: CLIENT, requestedByName: '', saveContact: false });
    expect(parseOrder({ clientId: CLIENT, requestedByName: 'Pat', saveContact: true }).saveContact).toBe(true);
    expect(() => parseOrder({ clientId: CLIENT, contactId: 'x' })).toThrow(/saved contact/);
    expect(() => parseOrder({ clientId: CLIENT, requestedByName: 'Pat', channel: 'fax' })).toThrow(/email, phone, portal or other/);
    expect(() => parseOrder({ clientId: CLIENT, requestedByName: 'Pat', requestedByEmail: 'nope' })).toThrow('Their email must be an email address');
    expect(() => parseOrder({ clientId: CLIENT, requestedByName: 'Pat', clientReference: 'x'.repeat(61) })).toThrow(/Their reference is too long/);
  });

  it('fills who asked from a saved contact, typed details winning', () => {
    const contact = { name: 'Pat Ward', email: 'pat@bayside.example', phone: '0400 000 000' };
    expect(whoAsked({ requestedByName: '', requestedByEmail: null, requestedByPhone: null }, contact)).toEqual(contact);
    expect(whoAsked({ requestedByName: '', requestedByEmail: null, requestedByPhone: '03 9000 0000' }, contact)).toEqual({ ...contact, phone: '03 9000 0000' });
    expect(whoAsked({ requestedByName: 'Sam', requestedByEmail: null, requestedByPhone: null }, null)).toEqual({ name: 'Sam', email: null, phone: null });
    expect(contactProblem({ clientId: CLIENT, active: true }, CLIENT)).toBeNull();
    expect(contactProblem(undefined, CLIENT)).toMatch(/wasn’t found/);
    expect(contactProblem({ clientId: 'other', active: true }, CLIENT)).toMatch(/another \{client\}/);
    expect(contactProblem({ clientId: CLIENT, active: false }, CLIENT)).toMatch(/switched off/);
    expect(parseContact({ name: ' Pat ', email: 'PAT@X.EXAMPLE' })).toEqual({ name: 'Pat', position: null, email: 'pat@x.example', phone: null, notes: null });
    expect(() => parseContact({})).toThrow('Name is required');
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

  it('asks a client who confirms bookings to confirm, and has a "client to confirm" stage', () => {
    const facts = { contactName: 'Pat Ward', businessName: 'Caring Example', personName: 'Sarah Example', role: 'Registered Nurse',
      siteName: 'Bayside Hospital', areaName: 'Ward 4', localDate: '2026-11-10', localStart: '07:00', localEnd: '15:30', clientReference: 'PO-77', askToConfirm: true };
    const { subject, body } = clientConfirmationEmail(facts);
    expect(subject).toBe('Please confirm: Sarah Example for Ward 4, Bayside Hospital, Tue 10 Nov 07:00–15:30 (your ref PO-77)');
    expect(body).toContain('Caring Example has Sarah Example (Registered Nurse) ready for the shift you asked for. Please confirm you\'re happy with them:');
    expect(body).toContain('Please reply to this email or call Caring Example to confirm.');
    expect(body).not.toContain('is booked');
    expect(orderSummary({ total: 3, booked: 2, assigned: 0, open: 1, cancelled: 0, toConfirm: 1 })).toBe('2 of 3 filled · 1 for the client to confirm');
    expect(orderSummary({ total: 1, booked: 1, assigned: 0, open: 0, cancelled: 0, toConfirm: 1 },
      makeWords([{ code: 1015, singular: 'Customer', plural: 'Customers' }]))).toBe('All 1 shift filled · 1 for the customer to confirm');
    const booked = { status: 'booked', offersPending: 0, clientConfirms: true, clientConfirmedAt: null };
    expect(clientShiftStage(booked)).toBe('client_to_confirm');
    expect(waitsForClient(booked)).toBe(true);
    expect(clientShiftStage({ ...booked, clientConfirmedAt: '2026-11-02T00:00:00Z' })).toBe('booked');
    expect(clientShiftStage({ ...booked, clientConfirms: false })).toBe('booked');
    expect(clientShiftStage({ ...booked, status: 'assigned' })).toBe('assigned');
    // Either side can say yes first: the client's yes on an allocated shift waits for the worker.
    expect(clientShiftStage({ ...booked, status: 'assigned', clientConfirmedAt: '2026-11-02T00:00:00Z' })).toBe('worker_to_confirm');
    expect(clientShiftStage({ ...booked, status: 'assigned', clientConfirms: false, clientConfirmedAt: '2026-11-02T00:00:00Z' })).toBe('assigned');
    const ok = { onOrder: true, clientConfirms: true, status: 'booked', started: false, clientConfirmedAt: null };
    expect(clientConfirmRefusal(ok)).toBeNull();
    expect(clientConfirmRefusal({ ...ok, onOrder: false })).toMatch(/order/);
    expect(clientConfirmRefusal({ ...ok, clientConfirms: false })).toMatch(/doesn’t confirm bookings/);
    expect(clientConfirmRefusal({ ...ok, status: 'assigned' })).toBeNull();
    expect(clientConfirmRefusal({ ...ok, status: 'open' })).toBe('Put someone on the {shift} first: the {client} confirms the person');
    expect(clientConfirmRefusal({ ...ok, started: true })).toMatch(/already started/);
    expect(clientConfirmRefusal({ ...ok, clientConfirmedAt: '2026-11-02T00:00:00Z' })).toMatch(/already confirmed/);
  });
});

describe('client orders: change emails (rules)', () => {
  const base = { contactName: 'Pat', businessName: 'Caring Example', personName: 'Sarah Example', siteName: 'Bayside Campus', areaName: 'Ward 4',
    localDate: '2026-11-10', localStart: '08:00', localEnd: '16:30', clientReference: 'PO-1' };
  it('tells the client of a cancellation without naming anyone', () => {
    const m = clientChangeEmail({ ...base, kind: 'cancelled' });
    expect(m.subject).toBe('Cancelled: Ward 4, Bayside Campus, Tue 10 Nov 08:00–16:30 (your ref PO-1)');
    expect(m.body).toContain('has been cancelled');
    expect(m.body).not.toContain('Sarah');
  });
  it('says the person is no longer going, never why, and what happens next', () => {
    const m = clientChangeEmail({ ...base, kind: 'removed' });
    expect(m.subject).toMatch(/^Change of person: /);
    expect(m.body).toContain('Sarah Example is no longer going to the shift below.');
    expect(m.body).toContain('finding someone else');
    expect(clientChangeEmail({ ...base, kind: 'removed', someoneElseBooked: true }).body).toContain('emailed you separately');
  });
  it('shows what changed, with what it was, in the business’s words', () => {
    const w = makeWords([{ code: 1040, singular: 'Job', plural: 'Jobs' }, { code: 1030, singular: 'Unit', plural: 'Units' }]);
    const m = clientChangeEmail({ ...base, kind: 'changed', wasAreaName: 'Ward 2', wasLocalDate: '2026-11-10', wasLocalStart: '07:00', wasLocalEnd: '15:30' }, w);
    expect(m.subject).toBe('Changed: Ward 4, Bayside Campus, now Tue 10 Nov 08:00–16:30 (your ref PO-1)');
    expect(m.body).toContain('Sarah Example is still going.');
    expect(m.body).toContain('When: Tue 10 Nov 08:00–16:30 (was Tue 10 Nov 07:00–15:30)');
    expect(m.body).toContain('Unit: Ward 4 (was Ward 2)');
    expect(m.body).toContain('The job below has changed.');
    // Only the times changed: no "was" on the area.
    const t = clientChangeEmail({ ...base, kind: 'changed', wasAreaName: 'Ward 4', wasLocalDate: '2026-11-10', wasLocalStart: '07:00', wasLocalEnd: '15:30' });
    expect(t.body).toContain('Ward 4\n');
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
    const person = async (firstName: string, preferredName?: string) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, preferredName, lastName: 'Example', roles: ['Nurse'], email: `${firstName.toLowerCase()}@example.com` }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      await http().post(`/workers/${w}/employment`).set(as('admin')).send({ employmentType: 'casual', startsOn: '2026-01-01' }).expect(201);
      return w;
    };
    ids.sarah = await person('Sarah');
    ids.tom = await person('Thomas', 'Tom'); // the email uses the name he goes by
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
    expect(r.counts).toEqual({ open: 4, offered: 0, assigned: 0, worker_to_confirm: 0, client_to_confirm: 0, booked: 0 });
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
    expect(sent[1].body).not.toContain('Thomas');
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

  it('saves a client’s set-up: confirms bookings and rank', async () => {
    const created = (await http().post('/clients').set(as('admin')).send({ name: 'Loyal Aged Care', confirmsBookings: true, rank: 1 }).expect(201)).body;
    expect(created).toMatchObject({ confirmsBookings: true, rank: 1 });
    ids.loyal = created.id;
    expect((await http().get(`/clients/${ids.bayside}`).set(as('alloc')).expect(200)).body).toMatchObject({ confirmsBookings: false, rank: null });
    await http().patch(`/clients/${ids.bayside}`).set(as('alloc')).send({ rank: 2 }).expect(403);
    await http().patch(`/clients/${ids.bayside}`).set(as('admin')).send({ rank: 8 }).expect(400);
    await http().patch(`/clients/${ids.bayside}`).set(as('admin')).send({ confirmsBookings: 'yes' }).expect(400);
    const p = (await http().patch(`/clients/${ids.bayside}`).set(as('admin')).send({ confirmsBookings: true, rank: 3 }).expect(200)).body;
    expect(p).toMatchObject({ confirmsBookings: true, rank: 3 });
    // Leaving a field out keeps it; null clears the rank.
    expect((await http().patch(`/clients/${ids.bayside}`).set(as('admin')).send({ phone: '03 9000 0001' }).expect(200)).body).toMatchObject({ confirmsBookings: true, rank: 3 });
    expect((await http().patch(`/clients/${ids.hill}`).set(as('admin')).send({ rank: 5 }).expect(200)).body.rank).toBe(5);
    expect((await http().patch(`/clients/${ids.hill}`).set(as('admin')).send({ rank: null }).expect(200)).body.rank).toBeNull();
    const list = (await http().get('/clients').set(as('alloc')).expect(200)).body as { name: string; rank: number | null }[];
    expect(list.find(c => c.name === 'Loyal Aged Care')).toMatchObject({ confirmsBookings: true, rank: 1 });
    expect((await owner.query(`select 1 from audit_log where table_name = 'clients' and row_id = $1 and action = 'update'`, [ids.bayside])).rowCount).toBeGreaterThan(0);
    // The other business sees none of it.
    await http().get(`/clients/${ids.bayside}`).set(as('nosy')).expect(404);
  });

  it('waits for the client to confirm a booking, then records their yes', async () => {
    const before = (await emails()).length;
    const shiftId = (await http().post('/client-orders').set(as('alloc')).send(order({ date: ahead(9), clientReference: 'PO-90' })).expect(201)).body.ids[0] as string;
    const stageOf = async () => ((await http().get('/allocations/client-shifts?days=31').set(as('alloc')).expect(200)).body.shifts as { id: string; stage: string }[])
      .find(s => s.id === shiftId)!.stage;
    // Not booked yet: refused.
    const early = await http().post(`/shifts/${shiftId}/client-confirmed`).set(as('alloc')).expect(409);
    expect(early.body.message).toBe('Put someone on the shift first: the client confirms the person');
    await http().post(`/shifts/${shiftId}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    expect(await stageOf()).toBe('assigned');
    await http().post(`/shifts/${shiftId}/confirm`).set(as('alloc')).expect(200);
    expect(await stageOf()).toBe('client_to_confirm');
    const counts = (await http().get('/allocations/client-shifts?days=31').set(as('alloc')).expect(200)).body.counts;
    // Bayside's earlier booked shifts count too: the setting applies to bookings not yet confirmed, whenever made.
    expect(counts.client_to_confirm).toBe(5);
    const roster = (await http().get(`/shifts/${shiftId}`).set(as('alloc')).expect(200)).body;
    expect(roster).toMatchObject({ clientConfirms: true, clientConfirmedAt: null });

    // The email asks the client to confirm.
    expect(await confirmations().runOnce()).toBe(1);
    const sent = (await emails()).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/^Please confirm: Sarah Example for Ward 4, Bayside Campus, .* \(your ref PO-90\)$/);
    expect(sent[0].body).toContain('Please reply to this email or call Caring Example to confirm.');
    const orders = (await http().get('/client-orders').set(as('alloc')).expect(200)).body as { clientReference: string; summary: string }[];
    expect(orders.find(o => o.clientReference === 'PO-90')!.summary).toBe('All 1 shift filled · 1 for the client to confirm');

    // Only the office records it, once; nothing goes in the shift log (not a roster change).
    await http().post(`/shifts/${shiftId}/client-confirmed`).set(as('worker')).expect(403);
    await http().post(`/shifts/${shiftId}/client-confirmed`).set(as('nosy')).expect(404);
    const changes = (await owner.query('select count(*)::int as n from shift_changes where shift_id = $1', [shiftId])).rows[0].n;
    const done = (await http().post(`/shifts/${shiftId}/client-confirmed`).set(as('alloc')).expect(200)).body;
    expect(done.clientConfirmedAt).not.toBeNull();
    expect(done.clientConfirmedBy).toBeTruthy();
    expect(await stageOf()).toBe('booked');
    expect((await owner.query('select count(*)::int as n from shift_changes where shift_id = $1', [shiftId])).rows[0].n).toBe(changes);
    expect((await owner.query(`select 1 from audit_log where table_name = 'shifts' and row_id = $1 and action = 'update' and new_values ? 'client_confirmed_at'`, [shiftId])).rowCount).toBe(1);
    const again = await http().post(`/shifts/${shiftId}/client-confirmed`).set(as('alloc')).expect(409);
    expect(again.body.message).toBe('The client has already confirmed this person');

    // Undo puts it back; a different person booked later needs the client's yes again.
    await http().post(`/shifts/${shiftId}/client-confirmed/undo`).set(as('alloc')).expect(200);
    expect(await stageOf()).toBe('client_to_confirm');
    await http().post(`/shifts/${shiftId}/client-confirmed/undo`).set(as('alloc')).expect(409);
    await http().post(`/shifts/${shiftId}/client-confirmed`).set(as('alloc')).expect(200);
    await http().post(`/shifts/${shiftId}/unassign`).set(as('alloc')).send({}).expect(200);
    await http().post(`/shifts/${shiftId}/assign`).set(as('alloc')).send({ workerId: ids.tom }).expect(200);
    await http().post(`/shifts/${shiftId}/confirm`).set(as('alloc')).expect(200);
    expect(await stageOf()).toBe('client_to_confirm');
  });

  it('lets the client say yes first: waits for the worker, then sends the plain booked email', async () => {
    await confirmations().runOnce(); // what earlier tests booked
    const before = (await emails()).length;
    const shiftId = (await http().post('/client-orders').set(as('alloc')).send(order({ date: ahead(11), clientReference: 'PO-91' })).expect(201)).body.ids[0] as string;
    const stageOf = async () => ((await http().get('/allocations/client-shifts?days=31').set(as('alloc')).expect(200)).body.shifts as { id: string; stage: string }[])
      .find(s => s.id === shiftId)!.stage;
    await http().post(`/shifts/${shiftId}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    expect(await stageOf()).toBe('assigned');
    // The client is happy with Sarah before she has said yes.
    const yes = (await http().post(`/shifts/${shiftId}/client-confirmed`).set(as('alloc')).expect(200)).body;
    expect(yes).toMatchObject({ status: 'assigned', clientConfirms: true });
    expect(yes.clientConfirmedAt).not.toBeNull();
    expect(await stageOf()).toBe('worker_to_confirm');
    const counts = (await http().get('/allocations/client-shifts?days=31').set(as('alloc')).expect(200)).body.counts;
    expect(counts.worker_to_confirm).toBe(1);
    expect(await confirmations().runOnce()).toBe(0); // nothing until the worker confirms
    // Sarah confirms: both have said yes, so it's booked and the client gets "Booked", not "Please confirm".
    await http().post(`/shifts/${shiftId}/confirm`).set(as('alloc')).expect(200);
    expect(await stageOf()).toBe('booked');
    expect(await confirmations().runOnce()).toBe(1);
    expect(await confirmations().runOnce()).toBe(0);
    const sent = (await emails()).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/^Booked: Sarah Example for Ward 4, Bayside Campus, .* \(your ref PO-91\)$/);
    expect(sent[0].body).not.toContain('Please reply to this email');
  });

  it('a client’s yes belongs to the person: someone else on the shift waits for the client again', async () => {
    const shiftId = (await http().post('/client-orders').set(as('alloc')).send(order({ date: ahead(13), clientReference: 'PO-92' })).expect(201)).body.ids[0] as string;
    const stageOf = async () => ((await http().get('/allocations/client-shifts?days=31').set(as('alloc')).expect(200)).body.shifts as { id: string; stage: string }[])
      .find(s => s.id === shiftId)!.stage;
    await http().post(`/shifts/${shiftId}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    await http().post(`/shifts/${shiftId}/client-confirmed`).set(as('alloc')).expect(200);
    await http().post(`/shifts/${shiftId}/client-confirmed`).set(as('alloc')).expect(409);
    await http().post(`/shifts/${shiftId}/unassign`).set(as('alloc')).send({}).expect(200);
    expect(await stageOf()).toBe('open');
    await http().post(`/shifts/${shiftId}/assign`).set(as('alloc')).send({ workerId: ids.tom }).expect(200);
    expect(await stageOf()).toBe('assigned');
    await http().post(`/shifts/${shiftId}/confirm`).set(as('alloc')).expect(200);
    expect(await stageOf()).toBe('client_to_confirm');
    // Tom hasn't been confirmed by the client, so the email asks them to.
    expect(await confirmations().runOnce()).toBe(1);
    expect((await emails()).at(-1)!.subject).toMatch(/^Please confirm: Tom Example/);
  });

  it('refuses a client confirmation for shifts that aren’t from such a client’s order', async () => {
    const own = (await http().post('/shifts').set(as('alloc')).send({ facilityId: ids.office, role: 'Admin', date: ahead(10), startTime: '09:00', endTime: '17:00' }).expect(201)).body;
    const ownId = (Array.isArray(own.ids) ? own.ids[0] : own.id) as string;
    expect((await http().post(`/shifts/${ownId}/client-confirmed`).set(as('alloc')).expect(409)).body.message).toBe('This shift isn’t from a client’s order');
    const hillShift = (await http().post('/client-orders').set(as('alloc')).send(order({ clientId: ids.hill, facilityId: ids.hillSite, areaId: undefined, date: ahead(10) })).expect(201)).body.ids[0];
    await http().post(`/shifts/${hillShift}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    await http().post(`/shifts/${hillShift}/confirm`).set(as('alloc')).expect(200);
    expect((await http().post(`/shifts/${hillShift}/client-confirmed`).set(as('alloc')).expect(409)).body.message).toMatch(/doesn’t confirm bookings/);
    // Hillview doesn't confirm bookings: the usual "Booked" email.
    await confirmations().runOnce();
    const last = (await emails()).at(-1)!;
    expect(last.subject).toMatch(/^Booked: Sarah Example for Hillview House/);
  });

  it('sorts by start time, then the client’s rank (ranked first, 1 first)', async () => {
    await http().patch(`/clients/${ids.hill}`).set(as('admin')).send({ rank: 1 }).expect(200); // Bayside is 3
    const unranked = (await http().post('/clients').set(as('admin')).send({ name: 'Aardvark Care' }).expect(201)).body.id;
    const aSite = (await http().post('/facilities').set(as('admin')).send({ name: 'Aardvark House', state: 'VIC', clientId: unranked }).expect(201)).body.id;
    const at = { date: ahead(12), startTime: '06:00', endTime: '14:00', clientReference: 'SORT' };
    await http().post('/client-orders').set(as('alloc')).send(order({ ...at, clientId: unranked, facilityId: aSite, areaId: undefined })).expect(201);
    await http().post('/client-orders').set(as('alloc')).send(order({ ...at })).expect(201);
    await http().post('/client-orders').set(as('alloc')).send(order({ ...at, clientId: ids.hill, facilityId: ids.hillSite, areaId: undefined })).expect(201);
    const rows = ((await http().get('/allocations/client-shifts?days=31').set(as('alloc')).expect(200)).body.shifts as { clientName: string; clientRank: number | null; clientReference: string }[])
      .filter(s => s.clientReference === 'SORT');
    expect(rows.map(r => [r.clientName, r.clientRank])).toEqual([['Hillview Care', 1], ['Bayside Health', 3], ['Aardvark Care', null]]);
  });
  it('emails the client when a booking they were told about changes, the person is taken off, or it is cancelled', async () => {
    const changes = (settle = 0) => confirmations().runChanges(settle);
    const sentSince = async (n: number) => (await owner.query<{ subject: string; body: string; template: string }>(
      `select subject, body, template from notifications where template like 'client_booking_%' order by created_at`)).rows.slice(n);
    await confirmations().runOnce();
    await changes(); // what earlier tests changed
    const before = (await sentSince(0)).length;
    const shiftId = (await http().post('/client-orders').set(as('alloc')).send(order({ date: ahead(15), clientReference: 'PO-C1' })).expect(201)).body.ids[0] as string;
    // Nothing told yet: changing and cancelling an unfilled shift sends nothing.
    await http().post(`/shifts/${shiftId}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    await http().post(`/shifts/${shiftId}/confirm`).set(as('alloc')).expect(200);
    expect(await changes()).toBe(0);
    expect(await confirmations().runOnce()).toBe(1);
    const told = (await owner.query('select starts_at from client_order_confirmations where shift_id = $1', [shiftId])).rows[0];
    expect(told.starts_at).not.toBeNull();

    // New times: waits while the office is still at it, then one email with the old and new times.
    await http().put(`/shifts/${shiftId}/times`).set(as('alloc')).send({ startTime: '08:00', endTime: '16:30', breakMinutes: 30 }).expect(200);
    expect(await changes(120)).toBe(0);
    expect(await changes()).toBe(1);
    expect(await changes()).toBe(0);
    let sent = await sentSince(before + 1);
    expect(sent[0].template).toBe('client_booking_changed');
    expect(sent[0].subject).toMatch(/^Changed: Ward 4, Bayside Campus, now .* 08:00–16:30 \(your ref PO-C1\)$/);
    expect(sent[0].body).toMatch(/When: .* 08:00–16:30 \(was .* 07:00–15:30\)/);
    expect(sent[0].body).toContain('Sarah Example is still going.');
    // Put back as it was: the client is told again (compared with what they were told last).
    await http().put(`/shifts/${shiftId}/times`).set(as('alloc')).send({ startTime: '07:00', endTime: '15:30', breakMinutes: 30 }).expect(200);
    expect(await changes()).toBe(1);

    // Taken off: once, without a reason; then the next person gets the usual booked email.
    await http().post(`/shifts/${shiftId}/unassign`).set(as('alloc')).send({ pulledOut: true }).expect(200);
    expect(await changes()).toBe(1);
    expect(await changes()).toBe(0);
    sent = await sentSince(before + 3);
    expect(sent[0].template).toBe('client_booking_removed');
    expect(sent[0].body).toContain('Sarah Example is no longer going');
    expect(sent[0].body).toContain('finding someone else');
    expect(sent[0].body).not.toMatch(/pulled out/i);
    await http().post(`/shifts/${shiftId}/assign`).set(as('alloc')).send({ workerId: ids.tom }).expect(200);
    await http().post(`/shifts/${shiftId}/confirm`).set(as('alloc')).expect(200);
    expect(await confirmations().runOnce()).toBe(1);
    expect(await changes()).toBe(0);

    // Cancelled: at once (no settling), once.
    await http().post(`/shifts/${shiftId}/cancel`).set(as('alloc')).send({ reason: 'Client no longer needs it' }).expect(200);
    expect(await changes(120)).toBe(1);
    expect(await changes()).toBe(0);
    sent = await sentSince(before + 5);
    expect(sent.map(m => m.template)).toEqual(['client_booking_cancelled']);
    expect(sent[0].subject).toMatch(/^Cancelled: Ward 4, Bayside Campus, .* \(your ref PO-C1\)$/);
    expect(sent[0].body).not.toContain('Client no longer needs it');
    // Each is recorded against the booking it was about; crop_app can't change the record.
    const kinds = (await owner.query<{ kind: string }>('select kind from client_order_notices where shift_id = $1 order by sent_at', [shiftId])).rows.map(r => r.kind);
    expect(kinds).toEqual(['changed', 'changed', 'removed', 'cancelled']);

    // An order that didn't want emails: nothing about its changes either.
    const quiet = (await http().post('/client-orders').set(as('alloc')).send(order({ date: ahead(16), confirmToClient: false })).expect(201)).body.ids[0];
    await http().post(`/shifts/${quiet}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    await http().post(`/shifts/${quiet}/confirm`).set(as('alloc')).expect(200);
    await http().post(`/shifts/${quiet}/cancel`).set(as('alloc')).send({ reason: 'Not needed' }).expect(200);
    expect(await confirmations().runOnce()).toBe(0);
    expect(await changes()).toBe(0);
  });

  it('saves client contacts and takes an order from one (migration 0072)', async () => {
    await http().post(`/clients/${ids.hill}/contacts`).set(as('worker')).send({ name: 'Jo Bloggs' }).expect(403);
    const jo = (await http().post(`/clients/${ids.hill}/contacts`).set(as('alloc')).send({ name: 'Jo Bloggs', position: 'Nurse unit manager', email: 'Jo@Hillview.Example', phone: '0400 111 222' }).expect(201)).body;
    expect(jo).toMatchObject({ clientId: ids.hill, name: 'Jo Bloggs', email: 'jo@hillview.example', active: true });
    const twice = await http().post(`/clients/${ids.hill}/contacts`).set(as('alloc')).send({ name: 'jo bloggs' }).expect(400);
    expect(twice.body.message).toBe('This client already has a contact of that name');
    expect((await http().get(`/clients/${ids.hill}`).set(as('alloc')).expect(200)).body.contacts.map((c: { name: string }) => c.name)).toEqual(['Jo Bloggs']);
    expect((await http().get('/client-contacts').set(as('alloc')).expect(200)).body).toEqual([expect.objectContaining({ id: jo.id, clientName: 'Hillview Care' })]);
    expect((await http().get('/client-contacts').set(as('nosy')).expect(200)).body).toEqual([]);
    await http().patch(`/client-contacts/${jo.id}`).set(as('nosy')).send({ phone: null }).expect(404);

    // An order from the contact: their details are copied onto the order; a typed phone wins.
    const hillOrder = (extra: Record<string, unknown>) => order({ clientId: ids.hill, facilityId: ids.hillSite, areaId: undefined, date: ahead(20), requestedByName: undefined, requestedByEmail: undefined, ...extra });
    const r = (await http().post('/client-orders').set(as('alloc')).send(hillOrder({ contactId: jo.id, requestedByPhone: '03 9000 0000' })).expect(201)).body;
    expect(r).toMatchObject({ contactId: jo.id, contactSaved: false, created: 1 });
    const row = (await owner.query('select requested_by_name, requested_by_email, requested_by_phone, contact_id from client_orders where id = $1', [r.orderId])).rows[0];
    expect(row).toEqual({ requested_by_name: 'Jo Bloggs', requested_by_email: 'jo@hillview.example', requested_by_phone: '03 9000 0000', contact_id: jo.id });

    // Another client's contact, or a switched-off one, is refused and nothing is made.
    const wrong = await http().post('/client-orders').set(as('alloc')).send(order({ contactId: jo.id, requestedByName: undefined })).expect(400);
    expect(wrong.body.message).toMatch(/another client/);
    await http().patch(`/client-contacts/${jo.id}`).set(as('alloc')).send({ active: false }).expect(200);
    await http().post('/client-orders').set(as('alloc')).send(hillOrder({ contactId: jo.id })).expect(400);
    expect((await http().get('/client-contacts').set(as('alloc')).expect(200)).body).toEqual([]);

    // Typed details saved as a new contact; the same name again links the live one instead of adding another.
    const typed = (await http().post('/client-orders').set(as('alloc')).send(hillOrder({ requestedByName: 'Lee Example', requestedByEmail: 'lee@hillview.example', saveContact: true })).expect(201)).body;
    expect(typed.contactSaved).toBe(true);
    const again = (await http().post('/client-orders').set(as('alloc')).send(hillOrder({ requestedByName: 'lee example', saveContact: true })).expect(201)).body;
    expect(again).toMatchObject({ contactId: typed.contactId, contactSaved: false });
    const lee = (await http().get(`/clients/${ids.hill}`).set(as('alloc')).expect(200)).body.contacts.find((c: { name: string }) => c.name === 'Lee Example');
    expect(lee).toMatchObject({ email: 'lee@hillview.example', active: true });
    // Editing a contact never changes the orders taken from it; every change is in the audit log.
    await http().patch(`/client-contacts/${lee.id}`).set(as('alloc')).send({ email: 'lee.new@hillview.example' }).expect(200);
    expect((await owner.query('select requested_by_email from client_orders where id = $1', [typed.orderId])).rows[0].requested_by_email).toBe('lee@hillview.example');
    expect((await owner.query(`select count(*)::int as n from audit_log where table_name = 'client_contacts'`)).rows[0].n).toBeGreaterThanOrEqual(4);
    // crop_app can't delete a contact.
    const app_ = new Client({ connectionString: db.appUrl });
    await app_.connect();
    await expect(app_.query('delete from client_contacts')).rejects.toThrow(/permission denied/);
    await app_.end();
  });
});

