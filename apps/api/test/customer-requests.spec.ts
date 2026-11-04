import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { createPool, withTenant } from '@crop/db';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import {
  customerRequestEmail, decideRefusal, floodRefusal, looksAutomated, parseCustomerRequest, placeLine, requestLine, RequestProblem,
  requestOrderRefusal,
} from '../src/clients/customer-requests.js';
import { startFakeIdp } from './fake-idp.js';

const FORM = {
  businessName: 'Sample Bakery', contactName: 'Pat Example', email: 'Pat@Example.com', phone: '03 9000 0000', frequency: 'repeat',
  address: '12 Example Street', suburb: 'Fitzroy', region: 'VIC', postcode: '3065', role: 'Barista',
  date: '2026-11-12', startTime: '07:00', endTime: '15:00', people: '2', notes: 'Back door entry',
};

describe('customer requests: rules (David, 3 Nov, answer 4)', () => {
  it('reads the public form and explains problems in plain words', () => {
    const r = parseCustomerRequest(FORM, '2026-11-05');
    expect(r).toMatchObject({ email: 'pat@example.com', people: 2, frequency: 'repeat', siteName: null, date: '2026-11-12' });
    const bad = (patch: Record<string, unknown>, today = '2026-11-05') => {
      try { parseCustomerRequest({ ...FORM, ...patch }, today); return null; } catch (e) { expect(e).toBeInstanceOf(RequestProblem); return (e as Error).message; }
    };
    expect(bad({ businessName: ' ' })).toBe('Business or organisation is needed');
    expect(bad({ email: 'nope' })).toBe('Your email doesn’t look right');
    expect(bad({ date: '2026-11-01' })).toBe('The date has passed: choose today or later');
    expect(bad({ date: '2027-06-01' })).toBe('Choose a date within 180 days');
    expect(bad({ startTime: '7am' })).toBe('Start time should look like 07:00');
    expect(bad({ endTime: '07:00' })).toBe('The finish time is the same as the start');
    expect(bad({ people: '0' })).toBe('How many people should be 1 to 20');
    expect(bad({ frequency: 'weekly' })).toBe('Choose once or ongoing');
    expect(bad({ phone: 'call me' })).toMatch(/digits only/);
    expect(bad({ date: '2026-11-05' })).toBeNull();
  });

  it('spots robots, floods and decided requests', () => {
    expect(looksAutomated({ website: 'http://spam' })).toBe(true);
    expect(looksAutomated({ website: '' })).toBe(false);
    expect(floodRefusal(29, 4)).toBeNull();
    expect(floodRefusal(30, 0)).toMatch(/a lot of requests/);
    expect(floodRefusal(0, 5)).toMatch(/several requests from you/);
    expect(decideRefusal('new')).toBeNull();
    expect(decideRefusal('accepted')).toBe('This request has already been accepted');
  });

  it('takes the order only from an accepted request, for its client, once (migration 0091)', () => {
    expect(requestOrderRefusal(undefined, 'c1')).toBe('Request not found');
    expect(requestOrderRefusal({ status: 'new', clientId: null, orderId: null }, 'c1')).toBe('Accept this request before taking the order');
    expect(requestOrderRefusal({ status: 'declined', clientId: null, orderId: null }, 'c1')).toBe('This request was declined');
    expect(requestOrderRefusal({ status: 'accepted', clientId: 'c1', orderId: 'o1' }, 'c1')).toBe('The order for this request has already been taken');
    expect(requestOrderRefusal({ status: 'accepted', clientId: 'c2', orderId: null }, 'c1')).toBe('This request was accepted for another {client}');
    expect(requestOrderRefusal({ status: 'accepted', clientId: 'c1', orderId: null }, 'c1')).toBeNull();
  });

  it('words the request for the office', () => {
    expect(requestLine({ role: 'Barista', people: 2, date: '2026-11-12', startTime: '07:00', endTime: '15:00' }, '2026')).toBe('2 × Barista, Thu 12 Nov 07:00–15:00');
    expect(requestLine({ role: 'Nurse', people: 1, date: '2027-01-02', startTime: '22:00', endTime: '06:30' }, '2026')).toBe('Nurse, Sat 2 Jan 2027 22:00–06:30 (overnight)');
    expect(placeLine({ siteName: 'Main shop', address: '12 Example Street', suburb: 'Fitzroy', region: 'VIC', postcode: '3065' })).toBe('Main shop, 12 Example Street, Fitzroy VIC 3065');
    const m = customerRequestEmail(parseCustomerRequest(FORM, '2026-11-05'), 'https://crop.example/');
    expect(m.subject).toBe('New request for staff: Sample Bakery');
    expect(m.body).toContain('https://crop.example/allocations?view=customers');
    expect(m.body).not.toContain('Back door entry');
    expect(m.body).not.toContain('pat@example.com');
  });
});

describe('customer requests: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let appPool: Pool;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
  const ahead = (n: number) => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const form = (patch: Record<string, unknown> = {}) => ({ ...FORM, date: ahead(7), ...patch });

  beforeAll(async () => {
    process.env.NOTIFY_DISPATCH = 'off';
    db = await createTestDatabase('crop_customer_requests');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('c4u','Caring Example'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($2,'nosy@x.com','owner')`, [ids.c4u, ids.nosy]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true, name: sub });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    appPool = createPool(db.appUrl);
  });

  afterAll(async () => {
    await appPool?.end();
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('is not available until the business switches it on, and never says which businesses exist', async () => {
    const off = await http().get('/request-page/c4u').expect(404);
    const none = await http().get('/request-page/no-such-business').expect(404);
    expect(off.body.message).toBe(none.body.message);
    await http().post('/request-page/c4u').send(form()).expect(404);
    await http().get('/request-page/BAD!').expect(404);
    expect((await http().get('/customer-request-page').set(as('alloc')).expect(200)).body).toMatchObject({ open: false, slug: 'c4u' });
    await http().put('/customer-request-page').set(as('alloc')).send({ open: true }).expect(403);
    const on = await http().put('/customer-request-page').set(as('admin')).send({ open: true, intro: 'Tell us what you need.' }).expect(200);
    expect(on.body).toMatchObject({ open: true, intro: 'Tell us what you need.' });
    const page = await http().get('/request-page/c4u').expect(200);
    expect(page.body).toMatchObject({ business: 'Caring Example', intro: 'Tell us what you need.', country: 'AU' });
  });

  it('takes a request without signing in, emails the office without the customer’s notes, and keeps nothing a robot sends', async () => {
    await http().post('/request-page/c4u').send(form({ email: 'nope' })).expect(400);
    await http().post('/request-page/c4u').send(form({ website: 'http://spam.example' })).expect(200);
    expect((await owner.query('select count(*)::int as n from customer_requests')).rows[0].n).toBe(0);
    await http().post('/request-page/c4u').send(form()).expect(200);
    const sent = (await owner.query(`select to_address, subject, body from notifications where template = 'customer_request'`)).rows;
    expect(sent.map(s => s.to_address)).toEqual(['admin@x.com']);
    expect(sent[0].subject).toBe('New request for staff: Sample Bakery');
    expect(sent[0].body).not.toContain('Back door entry');
    const list = await http().get('/customer-requests').set(as('alloc')).expect(200);
    expect(list.body).toMatchObject({ open: true, waiting: 1 });
    expect(list.body.requests[0]).toMatchObject({ businessName: 'Sample Bakery', email: 'pat@example.com', people: 2, status: 'new', notes: 'Back door entry' });
    expect(list.body.requests[0].line).toMatch(/^2 × Barista, /);
    ids.req = list.body.requests[0].id;
    // Another business sees nothing.
    expect((await http().get('/customer-requests').set(as('nosy')).expect(200)).body.requests).toEqual([]);
    expect((await withTenant(appPool, ids.nosy, db2 => db2.query('select * from customer_requests'))).rows).toEqual([]);
  });

  it('limits how many come from one email in a day', async () => {
    for (let i = 0; i < 4; i++) await http().post('/request-page/c4u').send(form({ email: 'busy@example.com', businessName: `Busy ${i}` })).expect(200);
    await http().post('/request-page/c4u').send(form({ email: 'busy@example.com', businessName: 'Busy 5' })).expect(200);
    const r = await http().post('/request-page/c4u').send(form({ email: 'BUSY@example.com', businessName: 'Busy 6' })).expect(409);
    expect(r.body.message).toMatch(/several requests from you/);
  });

  it('accepts a request as a new client with the contact saved, once', async () => {
    await http().post(`/customer-requests/${ids.req}/accept`).set(as('alloc')).send({}).expect(403);
    const r = await http().post(`/customer-requests/${ids.req}/accept`).set(as('admin')).send({}).expect(200);
    expect(r.body).toMatchObject({ createdClient: true, contactSaved: true });
    const client = (await http().get(`/clients/${r.body.clientId}`).set(as('admin')).expect(200)).body;
    expect(client).toMatchObject({ name: 'Sample Bakery', billingEmail: 'pat@example.com' });
    expect(client.contacts.map((c: { name: string }) => c.name)).toEqual(['Pat Example']);
    const again = await http().post(`/customer-requests/${ids.req}/accept`).set(as('admin')).send({}).expect(409);
    expect(again.body.message).toBe('This request has already been accepted');
    // Content can't be edited; the audit log has the decision.
    await expect(withTenant(appPool, ids.c4u, db2 => db2.query(`update customer_requests set business_name = 'X' where id = $1`, [ids.req]))).rejects.toThrow();
    const log = (await owner.query(`select action from audit_log where table_name = 'customer_requests' and row_id = $1 order by id`, [ids.req])).rows;
    expect(log.map(l => l.action)).toEqual(['insert', 'update']);
  });

  it('links a repeat customer to the client the business has, refuses a name clash, and declines', async () => {
    await http().post('/request-page/c4u').send(form({ email: 'pat@example.com' })).expect(200);
    const waiting = (await http().get('/customer-requests').set(as('admin')).expect(200)).body.requests.find((x: { businessName: string }) => x.businessName === 'Sample Bakery');
    const clash = await http().post(`/customer-requests/${waiting.id}/accept`).set(as('admin')).send({}).expect(409);
    expect(clash.body.message).toBe('There is already a client called Sample Bakery: choose it instead');
    const clientId = (await owner.query(`select id from clients where name = 'Sample Bakery'`)).rows[0].id;
    const r = await http().post(`/customer-requests/${waiting.id}/accept`).set(as('admin')).send({ clientId }).expect(200);
    expect(r.body).toMatchObject({ clientId, createdClient: false, contactSaved: false });
    const busy = (await http().get('/customer-requests').set(as('admin')).expect(200)).body.requests.find((x: { businessName: string }) => x.businessName === 'Busy 0');
    await http().post(`/customer-requests/${busy.id}/decline`).set(as('admin')).send({ note: 'Outside our area' }).expect(200);
    const all = (await http().get('/customer-requests?status=all').set(as('admin')).expect(200)).body;
    expect(all.requests.find((x: { id: string }) => x.id === busy.id)).toMatchObject({ status: 'declined', decidedNote: 'Outside our area' });
    expect(all.requests.find((x: { id: string }) => x.id === ids.req)).toMatchObject({ status: 'accepted', clientName: 'Sample Bakery' });
    expect(all.waiting).toBe(4);
  });

  it('takes the order from an accepted request in one step, once, and shows it on the request (migration 0091)', async () => {
    const clientId = (await owner.query(`select id from clients where name = 'Sample Bakery'`)).rows[0].id;
    const site = await http().post('/facilities').set(as('admin'))
      .send({ name: 'Sample Bakery', clientId, addressLine: '12 Example Street', suburb: 'Fitzroy', state: 'VIC', postcode: '3065' }).expect(201);
    const date = ahead(7);
    const body = {
      customerRequestId: ids.req, clientId, facilityId: site.body.id, role: 'Barista', date, startTime: '07:00', endTime: '15:00', quantity: 2,
      channel: 'request_page', requestedByName: 'Pat Example', requestedByEmail: 'pat@example.com', saveContact: true, orderNotes: 'Back door entry',
    };
    // Waiting and declined requests can't be ordered; nor for another client.
    const waiting = (await http().get('/customer-requests').set(as('alloc')).expect(200)).body.requests[0];
    const notYet = await http().post('/client-orders').set(as('alloc')).send({ ...body, customerRequestId: waiting.id }).expect(409);
    expect(notYet.body.message).toBe('Accept this request before taking the order');
    const other = (await owner.query(`insert into clients(tenant_id, name) values ($1,'Other Example') returning id`, [ids.c4u])).rows[0].id;
    const wrong = await http().post('/client-orders').set(as('alloc')).send({ ...body, clientId: other }).expect(400);
    expect(wrong.body.message).toMatch(/doesn’t belong to this client/);
    const made = await http().post('/client-orders').set(as('alloc')).send(body).expect(201);
    expect(made.body).toMatchObject({ created: 2, contactSaved: false });
    const again = await http().post('/client-orders').set(as('alloc')).send(body).expect(409);
    expect(again.body.message).toBe('The order for this request has already been taken');
    const all = (await http().get('/customer-requests?status=all').set(as('alloc')).expect(200)).body;
    expect(all.requests.find((x: { id: string }) => x.id === ids.req)).toMatchObject({ orderId: made.body.orderId, orderFacilityId: site.body.id, orderShifts: 2 });
    const orders = (await http().get('/client-orders').set(as('alloc')).expect(200)).body;
    expect(orders.find((o: { id: string }) => o.id === made.body.orderId)).toMatchObject({ channel: 'request_page', channelWords: 'Request page', total: 2 });
    // The order's shifts are ordinary client shifts in the queue.
    const shifts = (await owner.query(`select role, status from shifts where client_order_id = $1`, [made.body.orderId])).rows;
    expect(shifts).toEqual([{ role: 'Barista', status: 'open' }, { role: 'Barista', status: 'open' }]);
    // Another business can't use the request.
    await http().post('/client-orders').set(as('nosy')).send(body).expect(400);
  });

  it('stops taking requests once switched off', async () => {
    await http().put('/customer-request-page').set(as('admin')).send({ open: false }).expect(200);
    await http().post('/request-page/c4u').send(form({ email: 'late@example.com' })).expect(404);
    expect((await http().get('/customer-request-page').set(as('admin')).expect(200)).body.intro).toBe('Tell us what you need.');
  });
});
