import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { initialsOf, onTab, parseTab, progressLine, queueBand, queueOrder, queueStage, type ProgressFacts } from '../src/clients/allocation-queue.js';
import { makeWords } from '../src/terms/words.js';
import { startFakeIdp } from './fake-idp.js';

describe('allocation queue: rules (David chose layout A, 2 Nov)', () => {
  it('works out the queue stage, pulled out standing out from new and released', () => {
    expect(queueStage({ status: 'open', offersPending: 0, pulledOut: false })).toBe('new');
    expect(queueStage({ status: 'open', offersPending: 3, pulledOut: false })).toBe('released');
    expect(queueStage({ status: 'open', offersPending: 3, pulledOut: true })).toBe('pulled_out');
    expect(queueStage({ status: 'open', offersPending: 0, pulledOut: true })).toBe('pulled_out');
    expect(queueStage({ status: 'assigned', offersPending: 0, pulledOut: true })).toBe('accepted');
    expect(queueStage({ status: 'assigned', offersPending: 0, pulledOut: false, clientConfirms: true, clientConfirmedAt: 'T' })).toBe('worker_to_confirm');
    expect(queueStage({ status: 'booked', offersPending: 0, pulledOut: false, clientConfirms: true })).toBe('client_to_confirm');
    expect(queueStage({ status: 'booked', offersPending: 0, pulledOut: false })).toBe('booked');
  });

  it('puts booked shifts only on "Booked today", and only when booked today', () => {
    expect(onTab('all', 'new', false)).toBe(true);
    expect(onTab('all', 'booked', true)).toBe(false);
    expect(onTab('new', 'released', false)).toBe(false);
    expect(onTab('pulled_out', 'pulled_out', false)).toBe(true);
    expect(onTab('booked_today', 'booked', true)).toBe(true);
    expect(onTab('booked_today', 'booked', false)).toBe(false);
    expect(onTab('booked_today', 'client_to_confirm', true)).toBe(false);
    expect(parseTab('released')).toBe('released');
    expect(parseTab('nope')).toBe('all');
    expect(parseTab(undefined)).toBe('all');
  });

  it('bands shifts by how soon they start, in the site’s dates', () => {
    const now = new Date('2026-11-02T08:00:00Z'); // 19:00 in Melbourne
    const at = (iso: string, localDate: string) => queueBand({ startsAt: iso, localDate }, now, '2026-11-02', '2026-11-03');
    expect(at('2026-11-02T07:00:00Z', '2026-11-02')).toBe('started');
    expect(at('2026-11-02T09:30:00Z', '2026-11-02')).toBe('soon');
    expect(at('2026-11-02T10:00:00Z', '2026-11-02')).toBe('soon');
    expect(at('2026-11-02T12:00:00Z', '2026-11-02')).toBe('today');
    expect(at('2026-11-02T14:00:00Z', '2026-11-03')).toBe('tomorrow');
    expect(at('2026-11-04T00:00:00Z', '2026-11-04')).toBe('later');
  });

  it('sums up progress in a line, in the business’s words', () => {
    const base: ProgressFacts = { stage: 'new', workerName: null, offersTotal: 0, offersPending: 0, offersDeclined: 0, acceptedAt: null, viaOffer: false,
      pulledOutName: null, pulledOutAt: null, withAgencies: false };
    expect(progressLine(base)).toBe('Not offered yet');
    expect(progressLine({ ...base, stage: 'released', offersTotal: 6, offersPending: 4, offersDeclined: 2 })).toBe('Offered 6 · 2 declined');
    expect(progressLine({ ...base, stage: 'released', offersTotal: 11, offersPending: 11 })).toBe('Offered 11 · no replies');
    expect(progressLine({ ...base, withAgencies: true })).toBe('With agencies');
    expect(progressLine({ ...base, withAgencies: true }, makeWords([{ code: 1090, singular: 'Supplier', plural: 'Suppliers' }]))).toBe('With suppliers');
    expect(progressLine({ ...base, stage: 'accepted', workerName: 'Tom Example', acceptedAt: '18:58', viaOffer: true })).toBe('Tom Example accepted 18:58 · confirm');
    expect(progressLine({ ...base, stage: 'accepted', workerName: 'Tom Example', acceptedAt: '18:58' })).toBe('Tom Example allocated 18:58 · confirm');
    expect(progressLine({ ...base, stage: 'pulled_out', pulledOutName: 'Sarah Example', pulledOutAt: '18:31' })).toBe('Sarah Example pulled out 18:31 · rebook');
    expect(progressLine({ ...base, stage: 'pulled_out', pulledOutName: 'Sarah Example', pulledOutAt: '18:31', offersTotal: 4, offersPending: 4 }))
      .toBe('Sarah Example pulled out 18:31 · Offered 4 · no replies');
    expect(progressLine({ ...base, stage: 'worker_to_confirm', workerName: 'Tom Example' })).toBe('Client happy · waiting for Tom Example');
    expect(progressLine({ ...base, stage: 'client_to_confirm', workerName: 'Tom Example' }, makeWords([{ code: 1015, singular: 'Customer', plural: 'Customers' }])))
      .toBe('Tom Example booked · waiting for the customer');
  });

  it('orders by start time, then client rank (unranked last), and makes initials', () => {
    const r = (startsAt: string, clientRank: number | null, clientName: string) => ({ startsAt, clientRank, clientName, facilityName: 'S' });
    const list = [r('2026-11-02T10:00:00Z', null, 'A'), r('2026-11-02T10:00:00Z', 3, 'B'), r('2026-11-02T09:00:00Z', 7, 'C'), r('2026-11-02T10:00:00Z', 1, 'D')];
    expect(list.sort(queueOrder).map(x => x.clientName)).toEqual(['C', 'D', 'B', 'A']);
    expect(initialsOf('Jo Manager')).toBe('JM');
    expect(initialsOf('Jo Anne Manager')).toBe('JM');
    expect(initialsOf('alloc@x.com')).toBe('AL');
    expect(initialsOf('pat.example@x.com')).toBe('PE');
  });
});

describe('allocation queue: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  /** Local date and HH:MM in Melbourne `mins` from now. */
  const melb = (mins: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + mins * 60_000)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
  const order = async (extra: Record<string, unknown>) => (await http().post('/client-orders').set(as('alloc')).send({
    clientId: ids.bayside, facilityId: ids.bay, role: 'Nurse', date: ahead(3), startTime: '07:00', endTime: '15:00', quantity: 1,
    channel: 'phone', requestedByName: 'Pat Ward', ...extra,
  }).expect(201)).body.ids[0] as string;
  type Row = { id: string; stage: string; band: string; clientName: string; region: string | null; progress: string; presence: { initials: string }[]; youAreOn: boolean; waitingSince: string; pulledOutName: string | null };
  const queue = async (q = '', who = 'alloc') => (await http().get(`/allocations/queue${q}`).set(as(who)).expect(200)).body as {
    counts: Record<string, number>; regions: { name: string; count: number }[]; bands: Record<string, number>; total: number; shifts: Row[] };

  beforeAll(async () => {
    db = await createTestDatabase('crop_alloc_queue');
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

    ids.bayside = (await http().post('/clients').set(as('admin')).send({ name: 'Bayside Health', rank: 2, confirmsBookings: true }).expect(201)).body.id;
    ids.hill = (await http().post('/clients').set(as('admin')).send({ name: 'Hillview Care', rank: 1 }).expect(201)).body.id;
    ids.bay = (await http().post('/facilities').set(as('admin')).send({ name: 'Bayside Campus', state: 'VIC', clientId: ids.bayside }).expect(201)).body.id;
    ids.hillSite = (await http().post('/facilities').set(as('admin')).send({ name: 'Hillview House', state: 'NSW', timezone: 'Australia/Melbourne', clientId: ids.hill }).expect(201)).body.id;
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
    ids.ana = await person('Ana');

    // Soon: both start in about an hour; Hillview (rank 1) before Bayside (rank 2).
    const soon = melb(65), soonEnd = melb(65 + 240);
    ids.soonBay = await order({ date: soon.date, startTime: soon.time, endTime: soonEnd.time });
    ids.soonHill = await order({ clientId: ids.hill, facilityId: ids.hillSite, date: soon.date, startTime: soon.time, endTime: soonEnd.time });
    // Released: offered to Sarah (and Ana, who says no).
    ids.released = await order({ date: ahead(2), startTime: '08:00', endTime: '12:00' });
    await http().post(`/shifts/${ids.released}/offers`).set(as('alloc')).send({ workerIds: [ids.sarah, ids.ana], notify: false }).expect(201);
    const anaOffer = (await owner.query<{ id: string }>(`select id from shift_offers where shift_id = $1 and worker_id = $2`, [ids.released, ids.ana])).rows[0].id;
    await http().post(`/offers/${anaOffer}/decline`).set(as('alloc')).expect(200);
    // Accepted, waiting to confirm (Hillview doesn't confirm bookings).
    ids.accepted = await order({ clientId: ids.hill, facilityId: ids.hillSite, date: ahead(2), startTime: '13:00', endTime: '17:00' });
    await http().post(`/shifts/${ids.accepted}/assign`).set(as('alloc')).send({ workerId: ids.tom }).expect(200);
    // Bayside confirms bookings: client said yes first → worker to confirm.
    ids.workerToConfirm = await order({ date: ahead(2), startTime: '18:00', endTime: '22:00' });
    await http().post(`/shifts/${ids.workerToConfirm}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    await http().post(`/shifts/${ids.workerToConfirm}/client-confirmed`).set(as('alloc')).expect(200);
    // Worker confirmed, client hasn't.
    ids.clientToConfirm = await order({ date: ahead(3), startTime: '08:00', endTime: '12:00' });
    await http().post(`/shifts/${ids.clientToConfirm}/assign`).set(as('alloc')).send({ workerId: ids.tom }).expect(200);
    await http().post(`/shifts/${ids.clientToConfirm}/confirm`).set(as('alloc')).expect(200);
    // Fully booked today (Hillview).
    ids.booked = await order({ clientId: ids.hill, facilityId: ids.hillSite, date: ahead(3), startTime: '09:00', endTime: '13:00' }); // within 3 days at any hour
    await http().post(`/shifts/${ids.booked}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
    await http().post(`/shifts/${ids.booked}/confirm`).set(as('alloc')).expect(200);
    // Pulled out.
    ids.pulled = await order({ date: ahead(2), startTime: '06:00', endTime: '07:30' });
    await http().post(`/shifts/${ids.pulled}/assign`).set(as('alloc')).send({ workerId: ids.ana }).expect(200);
    await http().post(`/shifts/${ids.pulled}/unassign`).set(as('alloc')).send({ pulledOut: true }).expect(200);
    // Later than the window, and a shift at the business's own office: never in the queue.
    ids.far = await order({ date: ahead(9) });
    await http().post('/shifts').set(as('alloc')).send({ facilityId: ids.office, role: 'Admin', date: ahead(2), startTime: '09:00', endTime: '17:00' }).expect(201);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lists what still needs someone, most urgent first, with stage counts', async () => {
    const q = await queue();
    expect(q.counts).toEqual({ all: 7, new: 2, released: 1, accepted: 1, worker_to_confirm: 1, client_to_confirm: 1, pulled_out: 1, booked_today: 1 });
    expect(q.total).toBe(7);
    expect(q.shifts.map(s => s.id)).not.toContain(ids.booked);
    expect(q.shifts.map(s => s.id)).not.toContain(ids.far);
    // Same start: Hillview (rank 1) first.
    expect(q.shifts.slice(0, 2).map(s => s.id)).toEqual([ids.soonHill, ids.soonBay]);
    expect(q.shifts[0]).toMatchObject({ band: 'soon', stage: 'new', progress: 'Not offered yet', region: 'NSW' });
    expect(q.bands.soon).toBe(2);
    const by = Object.fromEntries(q.shifts.map(s => [s.id, s]));
    expect(by[ids.released]).toMatchObject({ stage: 'released', progress: 'Offered 2 · 1 declined' });
    expect(by[ids.accepted]).toMatchObject({ stage: 'accepted' });
    expect(by[ids.accepted].progress).toMatch(/^Tom Example allocated \d\d:\d\d · confirm$/);
    expect(by[ids.workerToConfirm]).toMatchObject({ stage: 'worker_to_confirm', progress: 'Client happy · waiting for Sarah Example' });
    expect(by[ids.clientToConfirm]).toMatchObject({ stage: 'client_to_confirm', progress: 'Tom Example booked · waiting for the client' });
    expect(by[ids.pulled]).toMatchObject({ stage: 'pulled_out', pulledOutName: 'Ana Example' });
    expect(by[ids.pulled].progress).toMatch(/^Ana Example pulled out \d\d:\d\d · rebook$/);
    // Waiting since the pull-out, which is after the order was taken.
    expect(new Date(by[ids.pulled].waitingSince).getTime()).toBeGreaterThan(new Date(by[ids.soonBay].waitingSince).getTime());
  });

  it('filters by tab, office (region), client and days', async () => {
    expect((await queue('?stage=new')).shifts.map(s => s.id)).toEqual([ids.soonHill, ids.soonBay]);
    expect((await queue('?stage=booked_today')).shifts.map(s => s.id)).toEqual([ids.booked]);
    expect((await queue('?stage=pulled_out')).shifts.map(s => s.id)).toEqual([ids.pulled]);
    const nsw = await queue('?region=NSW');
    expect(nsw.shifts.every(s => s.region === 'NSW')).toBe(true);
    expect(nsw.counts).toMatchObject({ all: 2, new: 1, accepted: 1, booked_today: 1, released: 0 });
    // Office counts ignore the office filter.
    expect(nsw.regions).toEqual([{ name: 'NSW', count: 2 }, { name: 'VIC', count: 5 }]);
    const hill = await queue(`?clientId=${ids.hill}`);
    expect(hill.regions).toEqual([{ name: 'NSW', count: 2 }]);
    expect(hill.shifts.every(s => s.clientName === 'Hillview Care')).toBe(true);
    expect((await queue('?days=14')).shifts.map(s => s.id)).toContain(ids.far);
    // Within a day: the two starting soon; never one two days out in the evening. (Early-morning shifts two UTC dates ahead
    // can fall within 24 hours late in the UTC day, so the count isn't fixed.)
    const day = (await queue('?days=1')).shifts.map(s => s.id);
    expect(day).toEqual(expect.arrayContaining([ids.soonHill, ids.soonBay]));
    expect(day).not.toContain(ids.workerToConfirm);
    expect(day).not.toContain(ids.far);
    await http().get('/allocations/queue?days=0').set(as('alloc')).expect(400);
    await http().get('/allocations/queue?days=15').set(as('alloc')).expect(400);
  });

  it('shows who else has a shift open (never a lock), for two minutes', async () => {
    await http().post(`/allocations/presence/${ids.soonBay}`).set(as('alloc')).expect(204);
    await http().post(`/allocations/presence/${ids.soonBay}`).set(as('alloc')).expect(204); // again: still one row
    const mine = (await queue()).shifts.find(s => s.id === ids.soonBay)!;
    expect(mine).toMatchObject({ presence: [], youAreOn: true });
    const theirs = (await queue('', 'admin')).shifts.find(s => s.id === ids.soonBay)!;
    expect(theirs).toMatchObject({ presence: [{ initials: 'AL' }], youAreOn: false });
    // The admin can still act on it.
    await http().post(`/shifts/${ids.soonBay}/assign`).set(as('admin')).send({ workerId: ids.ana }).expect(200);
    await http().post(`/shifts/${ids.soonBay}/unassign`).set(as('admin')).send({}).expect(200);
    await owner.query(`update allocation_presence set seen_at = now() - interval '3 minutes'`);
    expect((await queue('', 'admin')).shifts.find(s => s.id === ids.soonBay)!.presence).toEqual([]);
    // Another business's shift: nothing recorded (the row isn't visible to it).
    await http().post(`/allocations/presence/${ids.soonBay}`).set(as('nosy')).expect(204);
    expect((await owner.query(`select count(*)::int as n from allocation_presence where tenant_id = $1`, [ids.nosy])).rows[0].n).toBe(0);
    await http().post(`/allocations/presence/${ids.soonBay}`).set(as('worker')).expect(403);
  });

  it('is office-only and scoped to the business', async () => {
    await http().get('/allocations/queue').set(as('worker')).expect(403);
    const nosy = await queue('', 'nosy');
    expect(nosy.shifts).toEqual([]);
    expect(nosy.counts.all).toBe(0);
    expect(nosy.regions).toEqual([]);
  });
});
