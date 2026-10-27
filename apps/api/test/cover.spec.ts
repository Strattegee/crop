import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { attentionItems } from '../src/roster/attention.js';
import { coverGaps, coverGapWords, withArticle } from '../src/roster/cover.js';
import { holdsOn } from '../src/roster/cover-data.js';
import { addDays, todayIn } from '../src/workforce/compliance.js';
import { startFakeIdp } from './fake-idp.js';

describe('cover rules: gaps', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 10, 2, 0, 0) + h * 3_600_000);
  const s = (id: string, from: number, to: number, holds: boolean) => ({ id, startsAt: t(from), endsAt: t(to), holds });
  const show = (gaps: ReturnType<typeof coverGaps>) => gaps.map(g => [g.from.getTime(), g.to.getTime(), g.shiftIds]);

  it('finds the times someone is working without a holder', () => {
    // Holder 7–15:30; Ana 6–14; Ben 12–20; Cal 21–23.
    const gaps = coverGaps([s('holder', 7, 15.5, true), s('ana', 6, 14, false), s('ben', 12, 20, false), s('cal', 21, 23, false)]);
    expect(show(gaps)).toEqual([
      [t(6).getTime(), t(7).getTime(), ['ana']],
      [t(15.5).getTime(), t(20).getTime(), ['ben']],
      [t(21).getTime(), t(23).getTime(), ['cal']],
    ]);
  });

  it('joins back-to-back stretches and finds nothing when covered', () => {
    expect(show(coverGaps([s('a', 6, 10, false), s('b', 10, 14, false)]))).toEqual([[t(6).getTime(), t(14).getTime(), ['a', 'b']]]);
    expect(coverGaps([s('a', 6, 14, false), s('h1', 5, 10, true), s('h2', 10, 15, true)])).toEqual([]);
    expect(coverGaps([])).toEqual([]);
    // Handover between two holders with nobody else on: nothing to cover.
    expect(coverGaps([s('h1', 6, 10, true), s('h2', 11, 15, true)])).toEqual([]);
  });

  it('counts only verified credentials current on the date', () => {
    const c = (expiryDate: string | null, verification: 'verified' | 'unverified' | 'rejected' = 'verified') =>
      [{ id: 'c', credentialTypeId: 'fss', expiryDate, verification }];
    expect(holdsOn(c('2026-11-02'), 'fss', '2026-11-02')).toBe(true);
    expect(holdsOn(c('2026-11-01'), 'fss', '2026-11-02')).toBe(false);
    expect(holdsOn(c(null), 'fss', '2026-11-02')).toBe(true);
    expect(holdsOn(c(null, 'unverified'), 'fss', '2026-11-02')).toBe(false);
    expect(holdsOn(c(null), 'rsa', '2026-11-02')).toBe(false);
  });

  it('words the gap plainly', () => {
    expect(withArticle('RSA')).toBe('an RSA');
    expect(withArticle('Food safety supervisor')).toBe('a Food safety supervisor');
    expect(withArticle('Asbestos awareness')).toBe('an Asbestos awareness');
    expect(coverGapWords('Food safety supervisor', 'Harbour Kitchen', '15:30', '18:00')).toEqual({
      title: 'Nobody with a Food safety supervisor working 15:30–18:00',
      detail: 'Harbour Kitchen needs someone with a Food safety supervisor on whenever anyone is working there',
    });
  });

  it('lists gaps in Needs attention after blocked people, before open shifts', () => {
    const now = t(0);
    const items = attentionItems(
      [{ id: 'open', startsAt: t(3), equipmentOnly: false, workerName: null, assignmentStatus: null, offersPending: 0, offersExpired: 0, pulledOutName: null, personBlocks: [], equipmentBlocks: [] }],
      now, 24,
      [{ shiftId: 'x', from: t(5), to: t(6), title: 'Gap', detail: 'd' }, { shiftId: 'y', from: t(-2), to: t(1), title: 'Now', detail: 'd' }, { shiftId: 'z', from: t(-3), to: t(-1), title: 'Over', detail: 'd' }],
    );
    expect(items.map(i => [i.shiftId, i.kind, i.startsIn])).toEqual([
      ['y', 'cover_gap', 'happening now'], ['x', 'cover_gap', 'starts in 5 hours'], ['open', 'open', 'starts in 3 hours'],
    ]);
  });
});

describe('cover rules: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, otherSite: string, fss: string;
  let holder: string, ana: string, ben: string;
  const day = (n: number) => addDays(todayIn('Australia/Melbourne'), n);
  const shift = async (facilityId: string, date: string, startTime: string, endTime: string, workerId?: string) => {
    const id = (await http().post('/shifts').set(as('alloc')).send({ facilityId, role: 'Chef', date, startTime, endTime }).expect(201)).body.ids[0] as string;
    if (workerId) await http().post(`/shifts/${id}/assign`).set(as('alloc')).send({ workerId }).expect(200);
    return id;
  };

  beforeAll(async () => {
    db = await createTestDatabase('crop_cover');
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
    fss = (await http().post('/credential-types').set(as('admin')).send({ name: 'Food safety supervisor', category: 'training', hasNumber: false, needsEvidence: false }).expect(201)).body.id;
    const person = async (firstName: string, holds: boolean) => {
      const w = (await http().post('/workers').set(as('admin')).send({ firstName, lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id as string;
      await http().put(`/workers/${w}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
      await http().post(`/workers/${w}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
      if (holds) {
        const c = (await http().post(`/workers/${w}/credentials`).set(as('admin')).send({ credentialTypeId: fss, expiryDate: day(300) }).expect(201)).body.id;
        await http().post(`/workers/${w}/credentials/${c}/verify`).set(as('admin')).send({}).expect(201);
      }
      return w;
    };
    holder = await person('Hana', true);
    ana = await person('Ana', false);
    ben = await person('Ben', false);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('adds, lists and switches rules off and on (owners and admins)', async () => {
    await http().post('/cover-rules').set(as('alloc')).send({ credentialTypeId: fss }).expect(403);
    await http().post('/cover-rules').set(as('admin')).send({ credentialTypeId: 'nope' }).expect(400);
    await http().post('/cover-rules').set(as('admin')).send({ credentialTypeId: fss, facilityId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    const rule = (await http().post('/cover-rules').set(as('admin')).send({ credentialTypeId: fss, facilityId: site }).expect(201)).body;
    expect(rule).toMatchObject({ facilityId: site, facilityName: 'Harbour Kitchen', typeName: 'Food safety supervisor', active: true });
    const dup = await http().post('/cover-rules').set(as('admin')).send({ credentialTypeId: fss, facilityId: site }).expect(400);
    expect(dup.body.message).toBe('There is already a rule for that credential there');
    await http().patch(`/cover-rules/${rule.id}`).set(as('admin')).send({ active: false }).expect(200);
    // Adding it again switches the same rule back on.
    expect((await http().post('/cover-rules').set(as('admin')).send({ credentialTypeId: fss, facilityId: site }).expect(201)).body.id).toBe(rule.id);
    const list = (await http().get('/cover-rules').set(as('alloc')).expect(200)).body;
    expect(list).toHaveLength(1);
    await http().get('/cover-rules').set(as('worker')).expect(403);
    expect((await http().get('/cover-rules').set(as('other')).expect(200)).body).toEqual([]);
    await owner.query('delete from site_cover_rules where tenant_id is not null'); // the owner role may; crop_app may not
    const appDb = new Client({ connectionString: db.appUrl });
    await appDb.connect();
    await expect(appDb.query('delete from site_cover_rules')).rejects.toThrow(/permission denied/);
    await appDb.end();
  });

  it('lists gaps on the roster and in Needs attention', async () => {
    await http().post('/cover-rules').set(as('admin')).send({ credentialTypeId: fss }).expect(201); // every site
    // Hana (holder) 07:00–15:30; Ana 06:00–14:00; Ben 12:00–20:00 → gaps 06:00–07:00 and 15:30–20:00.
    await shift(site, day(2), '07:00', '15:30', holder);
    const anaShift = await shift(site, day(2), '06:00', '14:00', ana);
    const benShift = await shift(site, day(2), '12:00', '20:00', ben);
    await shift(site, day(2), '16:00', '20:00'); // open: doesn't count
    // Bay Cafe: Ana alone the next day, 22:00–02:00.
    const late = await shift(otherSite, day(3), '22:00', '02:00', ana);

    const r = await http().get(`/roster/cover-gaps?from=${day(0)}&to=${day(6)}`).set(as('alloc')).expect(200);
    expect(r.body.map((g: Record<string, unknown>) => [g.facilityName, g.localDate, g.localFrom, g.localTo, g.shiftId])).toEqual([
      ['Harbour Kitchen', day(2), '06:00', '07:00', anaShift],
      ['Harbour Kitchen', day(2), '15:30', '20:00', benShift],
      ['Bay Cafe', day(3), '22:00', '02:00 next day', late],
    ]);
    expect(r.body[1]).toMatchObject({ typeName: 'Food safety supervisor', title: 'Nobody with a Food safety supervisor working 15:30–20:00' });
    const one = await http().get(`/roster/cover-gaps?from=${day(0)}&to=${day(6)}&facilityId=${otherSite}`).set(as('alloc')).expect(200);
    expect(one.body).toHaveLength(1);
    await http().get(`/roster/cover-gaps?from=${day(6)}&to=${day(0)}`).set(as('alloc')).expect(400);
    await http().get(`/roster/cover-gaps?from=${day(0)}&to=${day(90)}`).set(as('alloc')).expect(400);
    await http().get(`/roster/cover-gaps?from=${day(0)}&to=${day(6)}`).set(as('worker')).expect(403);

    const att = await http().get(`/roster/attention?facilityId=${site}`).set(as('alloc')).expect(200);
    const gaps = att.body.items.filter((i: { kind: string }) => i.kind === 'cover_gap');
    expect(gaps.map((i: { shiftId: string; shift: { localStart: string } }) => [i.shiftId, i.shift.localStart])).toEqual([[anaShift, '06:00'], [benShift, '12:00']]);

    // Switched off: no gaps.
    const rules = (await http().get('/cover-rules').set(as('alloc')).expect(200)).body;
    await http().patch(`/cover-rules/${rules[0].id}`).set(as('admin')).send({ active: false }).expect(200);
    expect((await http().get(`/roster/cover-gaps?from=${day(0)}&to=${day(6)}`).set(as('alloc')).expect(200)).body).toEqual([]);
  });
});
