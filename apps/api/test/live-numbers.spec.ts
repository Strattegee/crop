import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { LIVE, livePeriod, liveWorded } from '../src/dashboard/kpis.js';
import { makeWords, T } from '../src/terms/words.js';
import { startFakeIdp } from './fake-idp.js';

describe('live numbers: rules (David, 3 Nov)', () => {
  it('works out each period in the business’s dates', () => {
    expect(livePeriod('today', '2026-11-03')).toEqual({ from: '2026-11-03', to: '2026-11-03' });
    expect(livePeriod('week', '2026-11-03')).toEqual({ from: '2026-11-02', to: '2026-11-08' }); // Tuesday
    expect(livePeriod('week', '2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' }); // Sunday
    expect(livePeriod('week', '2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-08' }); // Monday
    expect(livePeriod('last7', '2026-11-03')).toEqual({ from: '2026-10-28', to: '2026-11-03' });
    expect(livePeriod('month', '2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(livePeriod('month', '2028-02-29')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(livePeriod('month', '2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('defines each number once, with the business’s words', () => {
    expect(LIVE.filter(d => d.group === 'shifts').map(d => d.key)).toEqual(['requests', 'filled', 'waiting', 'unfilled', 'client_cancelled', 'other_cancelled']);
    expect(LIVE.filter(d => d.group === 'officers').map(d => d.key)).toEqual(['handled', 'messages', 'calls']);
    expect(LIVE.filter(d => d.group === 'personnel').map(d => d.key)).toEqual(['accepted', 'worked', 'pulled_out']);
    const w = makeWords([{ code: 1015, singular: 'Customer', plural: 'Customers' }, { code: 1040, singular: 'Job', plural: 'Jobs' }]);
    expect(liveWorded('{Client} requests', w, T)).toBe('Customer requests');
    expect(liveWorded('{Shifts} at {client} sites, {clients}, a {shift}', w, T)).toBe('Jobs at customer sites, customers, a job');
  });
});

describe('live numbers: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  /** Local date and HH:MM in Melbourne `mins` from now. */
  const melb = (mins: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + mins * 60_000)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  /** A client order starting soon (within today, Melbourne, except in the last minutes before midnight). */
  const order = async (who: string, client: string, site: string, mins = 10) => {
    const a = melb(mins), b = melb(mins + 60);
    return (await http().post('/client-orders').set(as(who)).send({
      clientId: client, facilityId: site, role: 'Nurse', date: a.date, startTime: a.time, endTime: b.time, quantity: 1, channel: 'phone', requestedByName: 'Pat Ward',
    }).expect(201)).body.ids[0] as string;
  };
  type Measure = { key: string; label: string; value: number; percent: number | null };
  type Live = {
    period: string; from: string; to: string; state: string | null; office: string | null; officeName: string | null;
    states: { name: string; requests: number }[]; offices: { id: string; name: string; requests: number }[];
    shifts: Measure[]; officers: { measures: Measure[]; rows: { name: string; handled: number; messages: number; calls: number }[] };
    personnel: { measures: Measure[]; rows: { name: string; accepted: number; worked: number; pulledOut: number }[] };
  };
  const live = async (q = '', who = 'admin') => (await http().get(`/dashboard/live${q}`).set(as(who)).expect(200)).body as Live;
  const values = (ms: Measure[]) => Object.fromEntries(ms.map(m => [m.key, m.value]));

  beforeAll(async () => {
    db = await createTestDatabase('crop_live_numbers');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('c4u','Caring Example'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'nosy@x.com','owner')`, [ids.c4u, ids.nosy]);
    for (const [sub, email, name] of [['admin', 'admin@x.com', 'Ada Admin'], ['alloc', 'alloc@x.com', 'Jo Allocator'], ['worker', 'w@x.com', 'W'], ['nosy', 'nosy@x.com', 'N']]) {
      idp.addUser({ sub, email, email_verified: true, name });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    for (const who of ['admin', 'alloc', 'worker', 'nosy']) await http().get('/me').set(as(who)).expect(200);

    ids.metro = (await http().post('/offices').set(as('admin')).send({ name: 'VIC Melbourne Metro', state: 'VIC' }).expect(201)).body.id;
    ids.coast = (await http().post('/offices').set(as('admin')).send({ name: 'QLD Sunshine Coast', state: 'QLD' }).expect(201)).body.id;
    const allocUser = (await owner.query<{ id: string }>(`select id from users where email = 'alloc@x.com'`)).rows[0].id;
    await http().put(`/offices/${ids.metro}/people`).set(as('admin')).send({ userIds: [allocUser] }).expect(200);
    ids.client = (await http().post('/clients').set(as('admin')).send({ name: 'Bayside Health' }).expect(201)).body.id;
    ids.vic = (await http().post('/facilities').set(as('admin')).send({ name: 'Bayside Campus', state: 'VIC', clientId: ids.client, officeId: ids.metro }).expect(201)).body.id;
    ids.qld = (await http().post('/facilities').set(as('admin')).send({ name: 'Noosa House', state: 'QLD', timezone: 'Australia/Melbourne', clientId: ids.client, officeId: ids.coast }).expect(201)).body.id;
    ids.own = (await http().post('/facilities').set(as('admin')).send({ name: 'Head Office', state: 'VIC' }).expect(201)).body.id;
    const person = async (firstName: string) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Nurse'], email: `${firstName.toLowerCase()}@example.com` }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      await http().post(`/workers/${w}/employment`).set(as('admin')).send({ employmentType: 'casual', startsOn: '2026-01-01' }).expect(201);
      return w;
    };
    ids.sarah = await person('Sarah');
    ids.tom = await person('Tom');
    ids.ana = await person('Ana');

    // VIC (Jo Allocator): open (offered to Sarah by email), allocated, booked ahead, booked and worked, client cancelled.
    const s1 = await order('alloc', ids.client, ids.vic, 10);
    await http().post(`/shifts/${s1}/offers`).set(as('alloc')).send({ workerIds: [ids.sarah] }).expect(201);
    const s2 = await order('alloc', ids.client, ids.vic, 12);
    await http().post(`/shifts/${s2}/assign`).set(as('alloc')).send({ workerId: ids.tom }).expect(200);
    const s3 = await order('alloc', ids.client, ids.vic, 30);
    await http().post(`/shifts/${s3}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    await http().post(`/shifts/${s3}/confirm`).set(as('alloc')).expect(200);
    const s4 = await order('alloc', ids.client, ids.vic, 14);
    await http().post(`/shifts/${s4}/assign`).set(as('alloc')).send({ workerId: ids.ana }).expect(200);
    await http().post(`/shifts/${s4}/confirm`).set(as('alloc')).expect(200);
    await owner.query(`update shifts set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = $1`, [s4]);
    const s5 = await order('alloc', ids.client, ids.vic, 16);
    await http().post(`/shifts/${s5}/cancel`).set(as('alloc')).send({ reason: 'Ward closed', kind: 'client_cancelled' }).expect(200);
    // QLD (Ada Admin): our mistake, Ana pulled out (open again), Tom booked ahead.
    const q1 = await order('admin', ids.client, ids.qld, 18);
    await http().post(`/shifts/${q1}/cancel`).set(as('admin')).send({ reason: 'Typed twice', kind: 'our_mistake' }).expect(200);
    const q2 = await order('admin', ids.client, ids.qld, 40);
    await http().post(`/shifts/${q2}/assign`).set(as('admin')).send({ workerId: ids.ana }).expect(200);
    await http().post(`/shifts/${q2}/unassign`).set(as('admin')).send({ pulledOut: true }).expect(200);
    const q3 = await order('admin', ids.client, ids.qld, 90);
    await http().post(`/shifts/${q3}/assign`).set(as('admin')).send({ workerId: ids.tom }).expect(200);
    await http().post(`/shifts/${q3}/confirm`).set(as('admin')).expect(200);
    // Not a client request: the business's own site.
    const a = melb(20), b = melb(80);
    await http().post('/shifts').set(as('alloc')).send({ facilityId: ids.own, role: 'Admin', date: a.date, startTime: a.time, endTime: b.time }).expect(201);
    // Calls: two by Jo, one by Ada.
    await http().post('/calls').set(as('alloc')).send({ workerId: ids.sarah, shiftId: s1, outcome: 'no_answer' }).expect(201);
    await http().post('/calls').set(as('alloc')).send({ clientId: ids.client, outcome: 'answered' }).expect(201);
    await http().post('/calls').set(as('admin')).send({ workerId: ids.ana, outcome: 'said_no' }).expect(201);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('counts client requests and how they ended up, with percentages', async () => {
    const l = await live('?period=last7');
    expect(l.period).toBe('last7');
    expect(values(l.shifts)).toEqual({ requests: 8, filled: 3, waiting: 1, unfilled: 2, client_cancelled: 1, other_cancelled: 1 });
    const pct = Object.fromEntries(l.shifts.map(m => [m.key, m.percent]));
    expect(pct).toEqual({ requests: null, filled: 37.5, waiting: 12.5, unfilled: 25, client_cancelled: 12.5, other_cancelled: 12.5 });
    expect(l.shifts[0].label).toBe('Client requests');
    expect(l.states).toEqual([{ name: 'QLD', requests: 3 }, { name: 'VIC', requests: 5 }]);
    expect(l.offices.map(o => [o.name, o.requests])).toEqual([['QLD Sunshine Coast', 3], ['VIC Melbourne Metro', 5]]);
  });

  it('counts each person’s accepted, worked and pull-outs', async () => {
    const l = await live('?period=last7');
    expect(values(l.personnel.measures)).toEqual({ accepted: 2, worked: 1, pulled_out: 1 });
    expect(l.personnel.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Sarah Example', accepted: 1, worked: 0, pulledOut: 0 }),
      expect.objectContaining({ name: 'Tom Example', accepted: 1, worked: 0, pulledOut: 0 }),
      expect.objectContaining({ name: 'Ana Example', accepted: 0, worked: 1, pulledOut: 1 }),
    ]));
    expect(l.personnel.rows).toHaveLength(3);
  });

  it('counts each officer’s shifts handled, messages sent and calls made', async () => {
    const l = await live('?period=last7');
    const by = Object.fromEntries(l.officers.rows.map(r => [r.name, r]));
    expect(by['Jo Allocator']).toMatchObject({ handled: 6, calls: 2 }); // five VIC orders plus their own-site shift
    expect(by['Jo Allocator'].messages).toBeGreaterThanOrEqual(1); // Sarah's offer email
    expect(by['Ada Admin']).toMatchObject({ handled: 3, calls: 1, messages: 0 });
    expect(values(l.officers.measures)).toMatchObject({ handled: 9, calls: 3 });
  });

  it('drills down by state and by office', async () => {
    const vic = await live('?period=last7&state=VIC');
    expect(vic.state).toBe('VIC');
    expect(values(vic.shifts)).toMatchObject({ requests: 5, filled: 2, waiting: 1, unfilled: 1, client_cancelled: 1, other_cancelled: 0 });
    expect(vic.offices.map(o => [o.name, o.requests])).toEqual([['VIC Melbourne Metro', 5]]);
    expect(vic.officers.rows.map(r => r.name)).toEqual(['Jo Allocator']);
    expect(vic.personnel.rows.map(r => r.name).sort()).toEqual(['Ana Example', 'Sarah Example']);
    const coast = await live(`?period=last7&office=${ids.coast}`);
    expect(coast.officeName).toBe('QLD Sunshine Coast');
    expect(values(coast.shifts)).toMatchObject({ requests: 3, filled: 1, unfilled: 1, other_cancelled: 1 });
    expect(values(coast.personnel.measures)).toEqual({ accepted: 1, worked: 0, pulled_out: 1 });
    expect(coast.officers.rows).toEqual([]); // nobody attached to it
    const none = await live('?period=last7&office=none');
    expect(values(none.shifts).requests).toBe(0);
    expect(none.officers.rows.map(r => r.name)).toEqual(['Ada Admin']);
  });

  it('defaults to this week and refuses odd choices', async () => {
    const l = await live('', 'alloc');
    expect(l.period).toBe('week');
    expect(Date.parse(`${l.to}T00:00:00Z`) - Date.parse(`${l.from}T00:00:00Z`)).toBe(6 * 86_400_000);
    await http().get('/dashboard/live?period=year').set(as('admin')).expect(400);
    await http().get('/dashboard/live?office=Metro').set(as('admin')).expect(400);
    await http().get('/dashboard/live?office=00000000-0000-4000-8000-000000000000').set(as('admin')).expect(404);
    await http().get('/dashboard/live').set(as('worker')).expect(403);
  });

  it('another business sees none of it', async () => {
    const l = await live('?period=last7', 'nosy');
    expect(values(l.shifts).requests).toBe(0);
    expect(l.states).toEqual([]);
    expect(l.offices).toEqual([]);
    expect(l.personnel.rows).toEqual([]);
    expect(l.officers.rows.every(r => r.handled === 0 && r.calls === 0 && r.messages === 0)).toBe(true);
    await http().get(`/dashboard/live?office=${ids.metro}`).set(as('nosy')).expect(404);
  });
});
