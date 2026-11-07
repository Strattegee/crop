import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import {
  defaultTab, doneDays, doneOrder, initialsOf, onTab, outcomeStage, parsePeriod, parseTab, progressLine, queueBand, queueOrder, queuePeriodDates, queueStage,
  type ProgressFacts,
} from '../src/clients/allocation-queue.js';
import {
  NO_FILTERS, anyColumnFilter, columnOptions, dayPart, matchesColumns, parseColumnFilters, parseSort, progressKinds, sortRows, type FilterRow,
} from '../src/clients/allocation-queue.js';
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

describe('allocation queue: calendar periods and outcomes (David, 4 Nov)', () => {
  it('gives ended and cancelled shifts their outcome as the stage', () => {
    const f = { offersPending: 0, pulledOut: false };
    expect(queueStage({ ...f, status: 'booked', ended: true })).toBe('worked');
    expect(queueStage({ ...f, status: 'booked', ended: true, clientConfirms: true })).toBe('worked');
    expect(queueStage({ ...f, status: 'open', ended: true })).toBe('unfilled');
    expect(queueStage({ ...f, status: 'open', ended: true, offersPending: 3 })).toBe('unfilled');
    expect(queueStage({ ...f, status: 'open', ended: true, pulledOut: true })).toBe('not_refilled');
    expect(queueStage({ ...f, status: 'assigned', ended: true })).toBe('unconfirmed');
    expect(queueStage({ ...f, status: 'cancelled', ended: false })).toBe('cancelled');
    expect(queueStage({ ...f, status: 'cancelled', ended: true })).toBe('cancelled');
    // Started but not ended: still live.
    expect(queueStage({ ...f, status: 'open', ended: false })).toBe('new');
    expect(outcomeStage({ status: 'booked', pulledOut: false })).toBeNull();
  });

  it('keeps outcomes off the live tabs and live stages off the outcome tabs', () => {
    expect(onTab('all', 'worked', false)).toBe(false);
    expect(onTab('booked_today', 'worked', true)).toBe(false);
    expect(onTab('pulled_out', 'not_refilled', false)).toBe(false);
    expect(onTab('done', 'worked', false)).toBe(true);
    expect(onTab('done', 'unconfirmed', false)).toBe(true);
    expect(onTab('done', 'new', false)).toBe(false);
    expect(onTab('done', 'booked', true)).toBe(false);
    expect(onTab('worked', 'worked', false)).toBe(true);
    expect(onTab('unfilled', 'unfilled', false)).toBe(true);
    expect(onTab('unfilled', 'not_refilled', false)).toBe(true);
    expect(onTab('unfilled', 'unconfirmed', false)).toBe(false);
    expect(onTab('cancelled', 'cancelled', false)).toBe(true);
    expect(onTab('cancelled', 'unfilled', false)).toBe(false);
  });

  it('reads periods and tabs: outcome tabs only with a calendar period, previous month opens on Done', () => {
    expect(parsePeriod('week')).toBe('week');
    expect(parsePeriod('prev_month')).toBe('prev_month');
    expect(parsePeriod('year')).toBeNull();
    expect(parsePeriod(undefined)).toBeNull();
    expect(defaultTab(null)).toBe('all');
    expect(defaultTab('month')).toBe('all');
    expect(defaultTab('prev_month')).toBe('done');
    expect(parseTab('done')).toBe('all');
    expect(parseTab('done', 'week')).toBe('done');
    expect(parseTab('cancelled', 'month')).toBe('cancelled');
    expect(parseTab(undefined, 'prev_month')).toBe('done');
    expect(parseTab('new', 'prev_month')).toBe('new');
  });

  it('works out calendar periods in the business’s dates, across month and year ends', () => {
    expect(queuePeriodDates('week', '2026-11-04')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(queuePeriodDates('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' }); // Sunday
    expect(queuePeriodDates('week', '2026-12-31')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(queuePeriodDates('month', '2026-11-04')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(queuePeriodDates('prev_month', '2026-11-04')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(queuePeriodDates('prev_month', '2026-11-30')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(queuePeriodDates('prev_month', '2027-01-01')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(queuePeriodDates('prev_month', '2028-03-31')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(queuePeriodDates('prev_month', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('bands outcomes as done, worded and ordered by day, latest first', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    expect(queueBand({ startsAt: '2026-11-05T00:00:00Z', localDate: '2026-11-05', stage: 'cancelled' }, now, '2026-11-02', '2026-11-03')).toBe('done');
    expect(queueBand({ startsAt: '2026-11-01T00:00:00Z', localDate: '2026-11-01', stage: 'worked' }, now, '2026-11-02', '2026-11-03')).toBe('done');
    const base: ProgressFacts = { stage: 'worked', workerName: 'Tom Example', offersTotal: 0, offersPending: 0, offersDeclined: 0, acceptedAt: null, viaOffer: false,
      pulledOutName: null, pulledOutAt: null, withAgencies: false };
    expect(progressLine(base)).toBe('Tom Example worked it');
    expect(progressLine({ ...base, stage: 'unconfirmed' })).toBe('Tom Example was allocated but never confirmed');
    expect(progressLine({ ...base, stage: 'unfilled', workerName: null })).toBe('Nobody went · never offered');
    expect(progressLine({ ...base, stage: 'unfilled', workerName: null, offersTotal: 6, offersDeclined: 2 })).toBe('Nobody went · Offered 6 · 2 declined');
    expect(progressLine({ ...base, stage: 'not_refilled', workerName: null, pulledOutName: 'Ana Example', pulledOutAt: '18:31' })).toBe('Ana Example pulled out 18:31 · not refilled');
    expect(progressLine({ ...base, stage: 'cancelled', cancelWords: 'The client cancelled', cancelReason: 'Ward closed' })).toBe('Ward closed');
    expect(progressLine({ ...base, stage: 'cancelled', cancelWords: 'The client cancelled', cancelReason: ' ' })).toBe('The client cancelled');
    expect(progressLine({ ...base, stage: 'cancelled' })).toBe('Cancelled');
    const r = (localDate: string, startsAt: string, stage: 'worked' | 'unfilled' | 'cancelled' | 'not_refilled' | 'new') =>
      ({ localDate, startsAt, stage, clientRank: null, clientName: 'C', facilityName: 'S' });
    const rows = [r('2026-10-30', '2026-10-30T01:00:00Z', 'worked'), r('2026-10-31', '2026-10-31T05:00:00Z', 'unfilled'), r('2026-10-31', '2026-10-30T21:00:00Z', 'cancelled'),
      r('2026-10-31', '2026-10-31T02:00:00Z', 'not_refilled'), r('2026-11-03', '2026-11-03T02:00:00Z', 'new')];
    expect([...rows].sort(doneOrder).map(x => `${x.localDate} ${x.stage}`)).toEqual(['2026-11-03 new', '2026-10-31 cancelled', '2026-10-31 not_refilled', '2026-10-31 unfilled', '2026-10-30 worked']);
    expect(doneDays(rows)).toEqual([
      { date: '2026-10-31', total: 3, worked: 0, unfilled: 2, cancelled: 1 },
      { date: '2026-10-30', total: 1, worked: 1, unfilled: 0, cancelled: 0 },
    ]);
  });
});

describe('allocation queue: column filters and sorting (David, 7 Nov)', () => {
  const now = new Date('2026-11-07T00:00:00Z');
  const row = (o: Partial<FilterRow> = {}): FilterRow => ({
    band: 'today', stage: 'new', waitingSince: '2026-11-06T23:00:00Z', clientRank: 2, clientId: 'C1', clientName: 'Bayside', facilityId: 'F1',
    facilityName: 'Campus', areaName: 'Ward 3 East', role: 'Nurse', localDate: '2026-11-07', localStart: '07:00', hours: 8,
    offersTotal: 0, offersPending: 0, offersDeclined: 0, pulledOutName: null, presence: [], startsAt: '2026-11-07T08:00:00Z', ...o,
  });
  const uuid = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';

  it('reads the filters from the query, leaving out anything odd', () => {
    expect(parseColumnFilters({})).toEqual(NO_FILTERS);
    expect(anyColumnFilter(NO_FILTERS)).toBe(false);
    const f = parseColumnFilters({ band: 'soon,started,nope', waiting: '4h', stages: ['new', 'pulled_out', 'x'], rank: '1,none,9', clients: `${uuid.toUpperCase()},bad`,
      sites: uuid, area: ' east ', roles: ['Nurse', 'Carer'], dates: '2026-11-07,7 Nov', part: 'am,dusk', hrs: 'gt8', progress: 'some_declined', on: 'others' });
    expect(f).toEqual({ bands: ['soon', 'started'], waiting: '4h', stages: ['new', 'pulled_out'], ranks: [1, 0], clients: [uuid], sites: [uuid], area: 'east',
      roles: ['Nurse', 'Carer'], dates: ['2026-11-07'], parts: ['am'], hours: 'gt8', progress: ['some_declined'], on: 'others' });
    expect(anyColumnFilter(f)).toBe(true);
    expect(parseColumnFilters({ waiting: '2h', hrs: '9', on: 'me' })).toEqual(NO_FILTERS);
    expect(parseSort('-rank')).toEqual({ key: 'rank', desc: true });
    expect(parseSort('when')).toEqual({ key: 'when', desc: false });
    expect(parseSort('-nope')).toEqual({ key: 'default', desc: false });
  });

  it('matches each column, any value within one, every column across', () => {
    const m = (o: Partial<FilterRow>, q: Record<string, string>) => matchesColumns(row(o), parseColumnFilters(q), now);
    expect(m({}, { band: 'today,soon' })).toBe(true);
    expect(m({ band: 'later' }, { band: 'today,soon' })).toBe(false);
    // Waiting since 23:00 = an hour by midnight.
    expect(m({}, { waiting: '1h' })).toBe(true);
    expect(m({}, { waiting: '4h' })).toBe(false);
    expect(m({ waitingSince: null }, { waiting: '30m' })).toBe(false);
    expect(m({ clientRank: null }, { rank: 'none' })).toBe(true);
    expect(m({ clientRank: 2 }, { rank: '1,3' })).toBe(false);
    expect(m({}, { area: 'EAST' })).toBe(true);
    expect(m({ areaName: null }, { area: 'east' })).toBe(false);
    expect(m({}, { roles: 'Carer' })).toBe(false);
    expect(m({}, { dates: '2026-11-07,2026-11-08' })).toBe(true);
    expect(m({ localStart: '12:00' }, { part: 'am' })).toBe(false);
    expect(m({ hours: 4 }, { hrs: '4to8' })).toBe(true);
    expect(m({ hours: 3.5 }, { hrs: 'lt4' })).toBe(true);
    expect(m({ hours: 8.5 }, { hrs: '4to8' })).toBe(false);
    expect(m({}, { progress: 'not_offered' })).toBe(true);
    expect(m({ offersTotal: 3, offersPending: 2, offersDeclined: 1 }, { progress: 'no_replies' })).toBe(false);
    expect(m({ offersTotal: 3, offersPending: 3 }, { progress: 'no_replies' })).toBe(true);
    expect(m({ presence: [{}] }, { on: 'nobody' })).toBe(false);
    expect(m({ presence: [{}] }, { on: 'others' })).toBe(true);
    // Two columns at once: both must pass.
    expect(m({}, { roles: 'Nurse', hrs: 'lt4' })).toBe(false);
    // The tab counts leave out the Stage column.
    expect(matchesColumns(row(), parseColumnFilters({ stages: 'released' }), now, false)).toBe(true);
    expect(matchesColumns(row(), parseColumnFilters({ stages: 'released' }), now)).toBe(false);
  });

  it('sorts parts of the day and progress the way the roster and the progress line do', () => {
    expect(['04:59', '05:00', '11:59', '12:00', '18:59', '19:00'].map(dayPart)).toEqual(['night', 'am', 'am', 'pm', 'pm', 'night']);
    expect(progressKinds({ offersTotal: 0, offersPending: 0, offersDeclined: 0, pulledOutName: 'Ana' })).toEqual(['not_offered', 'pulled_out']);
    expect(progressKinds({ offersTotal: 4, offersPending: 1, offersDeclined: 2, pulledOutName: null })).toEqual(['some_declined']);
  });

  it('sorts by a heading, keeping the queue order on ties, with blanks last either way', () => {
    const a = row({ clientRank: 3, role: 'Nurse', hours: 8 }), b = row({ clientRank: null, role: 'Carer', hours: 4 }), c = row({ clientRank: 1, role: 'Nurse', hours: 6 });
    expect(sortRows([a, b, c], parseSort(''))).toEqual([a, b, c]);
    expect(sortRows([a, b, c], parseSort('rank'))).toEqual([c, a, b]);
    expect(sortRows([a, b, c], parseSort('-rank'))).toEqual([a, c, b]);
    expect(sortRows([a, b, c], parseSort('role'))).toEqual([b, a, c]);
    expect(sortRows([a, b, c], parseSort('-hours'))).toEqual([a, c, b]);
    const old = row({ waitingSince: '2026-11-01T00:00:00Z' }), none = row({ waitingSince: null }), recent = row({ waitingSince: '2026-11-06T00:00:00Z' });
    expect(sortRows([none, recent, old], parseSort('waiting'))).toEqual([old, recent, none]);
  });

  it('offers the values on the tab, sites only for the chosen clients', () => {
    const rows = [row(), row({ clientId: 'C2', clientName: 'Hillview', facilityId: 'F2', facilityName: 'House', role: 'Carer', localDate: '2026-11-08', stage: 'released' })];
    expect(columnOptions(rows, NO_FILTERS)).toEqual({
      stages: ['new', 'released'], clients: [{ id: 'C1', name: 'Bayside' }, { id: 'C2', name: 'Hillview' }],
      sites: [{ id: 'F1', name: 'Campus', clientId: 'C1' }, { id: 'F2', name: 'House', clientId: 'C2' }], roles: ['Carer', 'Nurse'], dates: ['2026-11-07', '2026-11-08'],
    });
    expect(columnOptions(rows, { ...NO_FILTERS, clients: ['c2'] }).sites).toEqual([{ id: 'F2', name: 'House', clientId: 'C2' }]);
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
    expect(q.counts).toEqual({ all: 7, new: 2, released: 1, accepted: 1, worker_to_confirm: 1, client_to_confirm: 1, pulled_out: 1, booked_today: 1,
      done: 0, worked: 0, unfilled: 0, cancelled: 0 });
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
    // Outcome tabs need a calendar period: without one, Done is the ordinary queue.
    expect((await queue('?stage=done')).counts.all).toBe(7);
  });

  it('filters by column, counts after the filters and sorts by a heading (David, 7 Nov)', async () => {
    const q = async (qs: string) => (await http().get(`/allocations/queue${qs}`).set(as('alloc')).expect(200)).body as {
      counts: Record<string, number>; total: number; shifts: Row[]; regions: { name: string; count: number }[];
      options: { stages: string[]; clients: { id: string }[]; sites: { id: string }[]; roles: string[]; dates: string[] }; sort: { key: string; desc: boolean } };
    const soon = await q('?band=soon');
    expect(soon.shifts.map(s => s.id)).toEqual([ids.soonHill, ids.soonBay]);
    expect(soon.counts).toMatchObject({ all: 2, new: 2, released: 0 });
    // The Stage column narrows the rows but not the tab counts (the tabs are its presets).
    const st = await q('?stages=released,pulled_out');
    expect(st.shifts.map(s => s.id).sort()).toEqual([ids.released, ids.pulled].sort());
    expect(st.counts.all).toBe(7);
    expect(st.options.stages).toEqual(['pulled_out', 'new', 'released', 'accepted', 'worker_to_confirm', 'client_to_confirm']);
    // Client and site, rank, progress, hours.
    const hill = await q(`?clients=${ids.hill}`);
    expect(hill.shifts.map(s => s.id).sort()).toEqual([ids.soonHill, ids.accepted].sort());
    expect(hill.regions).toEqual([{ name: 'NSW', count: 2 }]);
    expect(hill.options.sites.map(s => s.id)).toEqual([ids.hillSite]);
    expect(hill.options.clients).toHaveLength(2);
    expect((await q('?rank=1')).total).toBe(2);
    expect((await q('?progress=some_declined')).shifts.map(s => s.id)).toEqual([ids.released]);
    expect((await q('?progress=pulled_out')).shifts.map(s => s.id)).toEqual([ids.pulled]);
    expect((await q('?hrs=lt4')).shifts.map(s => s.id)).toEqual([ids.pulled]);
    expect((await q('?area=nowhere')).total).toBe(0);
    expect((await q('?on=others')).total).toBe(0);
    // Sorting by rank: Hillview (1) first; turned round, Bayside (2) first.
    const byRank = await q('?sort=rank');
    expect(byRank.sort).toEqual({ key: 'rank', desc: false });
    expect(byRank.shifts.slice(0, 2).every(s => s.clientName === 'Hillview Care')).toBe(true);
    expect((await q('?sort=-rank')).shifts[0].clientName).toBe('Bayside Health');
    // Odd values are left out, never refused.
    expect((await q('?band=nope&hrs=9&sort=sideways')).total).toBe(7);
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

  it('shows calendar periods with what happened to past shifts, in the business’s dates (David, 4 Nov)', async () => {
    const today = melb(0).date;
    const prev = queuePeriodDates('prev_month', today);
    const month = queuePeriodDates('month', today);
    const before = new Date(Date.parse(`${prev.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    /** Moves a shift to local (Melbourne) times, as if it had been ordered for then. */
    const moveTo = (id: string, date: string, start: string, hours: number) => owner.query(
      `update shifts set starts_at = ($2::date + $3::time) at time zone 'Australia/Melbourne', ends_at = ($2::date + $3::time) at time zone 'Australia/Melbourne' + make_interval(hours => $4) where id = $1`,
      [id, date, start, hours]);
    const made = async (setup?: (id: string) => Promise<unknown>) => {
      const id = await order({ date: ahead(5), startTime: '07:00', endTime: '15:00' });
      await setup?.(id);
      return id;
    };
    // The last night of the previous month (local 23:30, still the 30th/31st in UTC too late in the day): worked.
    const worked = await made(async id => {
      await http().post(`/shifts/${id}/assign`).set(as('alloc')).send({ workerId: ids.sarah }).expect(200);
      await http().post(`/shifts/${id}/confirm`).set(as('alloc')).expect(200);
    });
    await moveTo(worked, prev.to, '23:30', 8);
    // First thing on the 1st of the previous month (local 00:15 = the day before in UTC): in it. The night before: not.
    const firstMorning = await made();
    await moveTo(firstMorning, prev.from, '00:15', 1);
    const dayBefore = await made();
    await moveTo(dayBefore, before, '23:45', 1);
    const pulled = await made(async id => {
      await http().post(`/shifts/${id}/assign`).set(as('alloc')).send({ workerId: ids.ana }).expect(200);
      await http().post(`/shifts/${id}/unassign`).set(as('alloc')).send({ pulledOut: true }).expect(200);
    });
    await moveTo(pulled, prev.from, '09:00', 4);
    const cancelled = await made(id => http().post(`/shifts/${id}/cancel`).set(as('alloc')).send({ reason: 'Ward closed', kind: 'client_withdrew' }).expect(200));
    await moveTo(cancelled, prev.to, '07:00', 8);
    const unconfirmed = await made(id => http().post(`/shifts/${id}/assign`).set(as('alloc')).send({ workerId: ids.tom }).expect(200));
    await moveTo(unconfirmed, prev.to, '07:00', 8);
    // The first hour of the current month: never in the previous month.
    const thisMonth = await made();
    await moveTo(thisMonth, month.from, '00:30', 1);

    type PQ = Awaited<ReturnType<typeof queue>> & { period: string; from: string; to: string; more: number; doneDays: { date: string; total: number }[];
      shifts: (Row & { cancelKind: string | null; cancelWords: string | null; ended: boolean })[] };
    const p = await queue('?period=prev_month') as PQ;
    expect(p).toMatchObject({ period: 'prev_month', from: prev.from, to: prev.to, more: 0 });
    expect(p.counts).toMatchObject({ all: 0, new: 0, done: 5, worked: 1, unfilled: 2, cancelled: 1 });
    expect(p.total).toBe(5); // opens on Done
    const got = p.shifts.map(s => s.id);
    expect(got).not.toContain(dayBefore);
    expect(got).not.toContain(thisMonth);
    // Latest day first: the last day's three (by start), then the 1st's two.
    expect(got.slice(3).sort()).toEqual([firstMorning, pulled].sort());
    expect(got.slice(0, 3)).toContain(worked);
    const by = Object.fromEntries(p.shifts.map(s => [s.id, s]));
    expect(by[worked]).toMatchObject({ stage: 'worked', band: 'done', progress: 'Sarah Example worked it', ended: true, waitingSince: null });
    expect(by[firstMorning]).toMatchObject({ stage: 'unfilled', progress: 'Nobody went · never offered' });
    expect(by[pulled]).toMatchObject({ stage: 'not_refilled', pulledOutName: 'Ana Example' });
    expect(by[cancelled]).toMatchObject({ stage: 'cancelled', cancelKind: 'client_withdrew', progress: 'Ward closed', cancelWords: 'The client withdrew the request' });
    expect(by[unconfirmed]).toMatchObject({ stage: 'unconfirmed' });
    expect(p.doneDays.map(d => d.date)).toEqual([prev.to, prev.from]);
    expect((await queue('?period=prev_month&stage=unfilled')).shifts.map(s => s.id).sort()).toEqual([firstMorning, pulled].sort());
    expect((await queue('?period=prev_month&stage=cancelled')).shifts.map(s => s.id)).toEqual([cancelled]);
    // Paging: counts cover everything, rows come a page at a time.
    const one = await queue('?period=prev_month&limit=2') as PQ;
    expect([one.shifts.length, one.total, one.more]).toEqual([2, 5, 3]);

    const m = await queue('?period=month') as PQ;
    expect(m.from).toBe(month.from);
    expect(m.shifts.map(s => s.id)).not.toContain(worked); // opens on what still needs someone
    expect((await queue('?period=month&stage=done')).shifts.map(s => s.id)).toContain(thisMonth);
    expect((await queue('?period=month&stage=done')).shifts.map(s => s.id)).not.toContain(worked);
    const wk = await queue('?period=week') as PQ;
    expect(new Date(`${wk.from}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(new Date(`${wk.to}T00:00:00Z`).getUTCDay()).toBe(0);
    // The forward-looking default never shows them.
    expect((await queue()).shifts.map(s => s.id)).not.toContain(cancelled);
    await http().get('/allocations/queue?period=year').set(as('alloc')).expect(400);
  });

  it('is office-only and scoped to the business', async () => {
    await http().get('/allocations/queue').set(as('worker')).expect(403);
    const nosy = await queue('', 'nosy');
    expect(nosy.shifts).toEqual([]);
    expect(nosy.counts.all).toBe(0);
    expect(nosy.regions).toEqual([]);
  });
});
