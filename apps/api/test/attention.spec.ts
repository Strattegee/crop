import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { attentionCounts, attentionItems, offerNote, startsIn, type AttentionShift } from '../src/roster/attention.js';
import { addDays, todayIn } from '../src/workforce/compliance.js';
import { startFakeIdp } from './fake-idp.js';

describe('needs attention: rules', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const shift = (id: string, hours: number, extra: Partial<AttentionShift> = {}): AttentionShift => ({
    id, startsAt: at(hours), equipmentOnly: false, workerName: null, assignmentStatus: null, offersPending: 0, offersExpired: 0,
    pulledOutName: null, personBlocks: [], equipmentBlocks: [], ...extra,
  });

  it('says when a shift starts in plain words', () => {
    expect(startsIn(at(0.5), now)).toBe('starts within the hour');
    expect(startsIn(at(1.2), now)).toBe('starts in 1 hour');
    expect(startsIn(at(30), now)).toBe('starts in 30 hours');
    expect(startsIn(at(80), now)).toBe('starts in 3 days');
  });

  it('says what has been offered', () => {
    expect(offerNote({ offersPending: 0, offersExpired: 0, pulledOutName: null })).toBe('Not offered to anyone yet');
    expect(offerNote({ offersPending: 1, offersExpired: 2, pulledOutName: null })).toBe('Offered to 1 person, no reply yet');
    expect(offerNote({ offersPending: 0, offersExpired: 2, pulledOutName: null })).toBe('Offer to 2 people ran out with no reply');
    expect(offerNote({ offersPending: 3, offersExpired: 0, pulledOutName: 'Ana Example' })).toBe('Ana Example pulled out; offered to 3 people, no reply yet');
    // With agencies (employer-side escalation): who has been asked and when the next one is.
    const now = new Date('2026-11-02T09:00:00Z');
    expect(offerNote({ offersPending: 0, offersExpired: 0, pulledOutName: null, agency: { asked: 1, nextAt: new Date('2026-11-02T09:20:00Z') } }, now))
      .toBe('With agencies: 1 agency asked, nobody put forward yet; the next is asked in 20 min');
    expect(offerNote({ offersPending: 2, offersExpired: 0, pulledOutName: null, agency: { asked: 3, nextAt: null } }, now))
      .toBe('Offered to 2 people, no reply yet; with agencies: 3 agencies asked, nobody put forward yet; every agency has been asked');
    expect(offerNote({ offersPending: 0, offersExpired: 0, pulledOutName: null, agency: { asked: 0, nextAt: new Date('2026-11-02T11:00:00Z') } }, now))
      .toBe('With agencies, none asked yet; the next is asked in 2 hours');
  });

  it('puts urgent items first, then blocked, open and unconfirmed, then by start', () => {
    const items = attentionItems([
      shift('later-open', 50),
      shift('soon-unconfirmed', 5, { workerName: 'Ana Example', assignmentStatus: 'assigned' }),
      shift('later-blocked', 70, { workerName: 'Ben Sample', assignmentStatus: 'confirmed', personBlocks: ['Ben Sample is on leave that day.'] }),
      shift('soon-open', 10, { offersPending: 2 }),
      shift('fine', 8, { workerName: 'Cal Test', assignmentStatus: 'confirmed' }),
      shift('past', -1),
      shift('dry-hire', 20, { equipmentOnly: true, equipmentMissing: true }),
      shift('dry-hire-ok', 20, { equipmentOnly: true }),
      shift('machine', 60, { workerName: 'Cal Test', assignmentStatus: 'confirmed', equipmentBlocks: [{ name: 'Forklift 1', reasons: ['Forklift 1 is out of service'] }] }),
    ], now);
    expect(items.map(i => [i.shiftId, i.kind, i.urgent])).toEqual([
      ['soon-open', 'open', true],
      ['dry-hire', 'open', true],
      ['soon-unconfirmed', 'unconfirmed', true],
      ['later-blocked', 'person_blocked', false],
      ['machine', 'equipment_blocked', false],
      ['later-open', 'open', false],
    ]);
    expect(items[0]).toMatchObject({ title: 'Nobody on this shift', detail: 'Offered to 2 people, no reply yet', startsIn: 'starts in 10 hours' });
    expect(items[2].title).toBe("Ana Example hasn't confirmed");
    expect(items[3]).toMatchObject({ title: "Ben Sample can't work this shift now", detail: 'Ben Sample is on leave that day.' });
    expect(items[4].title).toBe("Forklift 1 can't be used on this shift now");
  });

  it('counts items by kind for the Dashboard', () => {
    const items = attentionItems([
      shift('a', 5), shift('b', 50), shift('c', 30, { workerName: 'Ana Example', assignmentStatus: 'assigned' }),
      shift('d', 70, { workerName: 'Ben Sample', assignmentStatus: 'confirmed', personBlocks: ['No.'] }),
    ], now);
    expect(attentionCounts(items)).toEqual({
      total: 4, urgent: 1, byKind: { person_blocked: 1, equipment_blocked: 0, cover_gap: 0, open: 2, unconfirmed: 1 },
    });
  });

  it("doesn't also ask for confirmation from someone who can't work it", () => {
    const items = attentionItems([shift('x', 30, { workerName: 'Ana Example', assignmentStatus: 'assigned', personBlocks: ['No.'] })], now);
    expect(items.map(i => i.kind)).toEqual(['person_blocked']);
  });
});

describe('needs attention: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, otherSite: string;
  let ana: string, ben: string, cal: string;
  // Days ahead in the site's time zone, so every shift is in the future whatever the time of day.
  const day = (n: number) => addDays(todayIn('Australia/Melbourne'), n);
  const shift = async (date: string, extra: Record<string, unknown> = {}) =>
    (await http().post('/shifts').set(as('alloc')).send({ facilityId: site, role: 'Chef', date, startTime: '09:00', endTime: '17:00', ...extra }).expect(201)).body.ids[0] as string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_attention');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const id = (s: string) => t.rows.find(r => r.slug === s)!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`, [id('cafe'), id('other')]);
    for (const [sub, email] of [['admin', 'admin@x.com'], ['alloc', 'alloc@x.com'], ['worker', 'w@x.com'], ['other', 'o@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    site = (await http().post('/facilities').set(as('admin')).send({ name: 'Harbour Kitchen', state: 'VIC' }).expect(201)).body.id;
    otherSite = (await http().post('/facilities').set(as('admin')).send({ name: 'Bay Cafe', state: 'VIC' }).expect(201)).body.id;
    const person = async (firstName: string) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      return w;
    };
    ana = await person('Ana');
    ben = await person('Ben');
    cal = await person('Cal');
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('lists what needs attention in the next week, most pressing first', async () => {
    const open = await shift(day(2));
    const offered = await shift(day(3));
    await http().post(`/shifts/${offered}/offers`).set(as('alloc')).send({ workerIds: [ana, cal], notify: false, expiresInMinutes: 60 }).expect(201);
    await owner.query(`update shift_offers set expires_at = now() - interval '1 minute' where shift_id = $1`, [offered]);
    const waiting = await shift(day(2), { startTime: '06:00', endTime: '08:00' });
    await http().post(`/shifts/${waiting}/assign`).set(as('alloc')).send({ workerId: ana }).expect(200);
    const booked = await shift(day(4));
    await http().post(`/shifts/${booked}/assign`).set(as('alloc')).send({ workerId: ben }).expect(200);
    await http().post(`/shifts/${booked}/confirm`).set(as('alloc')).expect(200);
    const fine = await shift(day(5));
    await http().post(`/shifts/${fine}/assign`).set(as('alloc')).send({ workerId: cal }).expect(200);
    await http().post(`/shifts/${fine}/confirm`).set(as('alloc')).expect(200);
    const cancelled = await shift(day(2));
    await http().post(`/shifts/${cancelled}/cancel`).set(as('alloc')).send({ reason: 'Closed' }).expect(200);
    const nextFortnight = await shift(day(10));
    await http().post('/shifts').set(as('alloc')).send({ facilityId: otherSite, role: 'Chef', date: day(2), startTime: '09:00', endTime: '17:00' }).expect(201);

    // Ben's leave is approved after he was booked: he can't work it now.
    await http().post(`/workers/${ben}/leave`).set(as('admin')).send({ kind: 'personal', startsOn: day(4), endsOn: day(4), approved: true }).expect(201);
    // A forklift on the shift that's fine for Cal goes out of service.
    const type = (await http().post('/equipment-types').set(as('admin')).send({ name: 'Forklift' }).expect(201)).body.id;
    const fork = (await http().post('/equipment').set(as('admin')).send({ equipmentTypeId: type, name: 'Forklift 1' }).expect(201)).body.id;
    await http().post(`/shifts/${fine}/equipment`).set(as('alloc')).send({ equipmentId: fork }).expect(200);
    await http().patch(`/equipment/${fork}`).set(as('admin')).send({ status: 'out_of_service' }).expect(200);

    const r = await http().get(`/roster/attention?facilityId=${site}`).set(as('alloc')).expect(200);
    expect(r.body).toMatchObject({ days: 7, truncated: false });
    const got = r.body.items.map((i: { shiftId: string; kind: string; title: string; detail: string }) => [i.shiftId, i.kind, i.title, i.detail]);
    expect(got).toEqual([
      [booked, 'person_blocked', "Ben Example can't work this shift now", expect.stringContaining('leave')],
      [fine, 'equipment_blocked', "Forklift 1 can't be used on this shift now", 'Forklift 1 is out of service'],
      [open, 'open', 'Nobody on this shift', 'Not offered to anyone yet'],
      [offered, 'open', 'Nobody on this shift', 'Offer to 2 people ran out with no reply'],
      [waiting, 'unconfirmed', "Ana Example hasn't confirmed", 'Waiting for them to agree to the shift'],
    ]);
    expect(r.body.total).toBe(5);
    expect(r.body.items[0].shift).toMatchObject({ id: booked, facilityName: 'Harbour Kitchen', role: 'Chef', localDate: day(4), localStart: '09:00', workerName: 'Ben Example' });
    // Never says the kind of leave.
    expect(JSON.stringify(r.body)).not.toMatch(/personal/i);

    const all = await http().get('/roster/attention?days=14').set(as('alloc')).expect(200);
    expect(all.body.items.map((i: { shiftId: string }) => i.shiftId)).toContain(nextFortnight);
    expect(all.body.items.filter((i: { shift: { facilityName: string } }) => i.shift.facilityName === 'Bay Cafe')).toHaveLength(1);
  });

  it('checks who asks and what they ask for', async () => {
    await http().get('/roster/attention').set(as('worker')).expect(403);
    await http().get('/roster/attention?days=20').set(as('alloc')).expect(400);
    await http().get('/roster/attention?days=two').set(as('alloc')).expect(400);
    await http().get('/roster/attention?facilityId=nope').set(as('alloc')).expect(400);
    const other = await http().get('/roster/attention?days=14').set(as('other')).expect(200);
    expect(other.body).toMatchObject({ total: 0, items: [] });
  });
});
