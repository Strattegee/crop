import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { DEFAULT_MARKER_LETTERS, markerLetters, parseMarkerLetters } from '../src/roster/markers.js';
import { startFakeIdp } from './fake-idp.js';

const WEEK = '2031-08-04';

describe('marker letters: rules', () => {
  it('fills in CROP defaults and ignores anything odd that was stored', () => {
    expect(markerLetters(null)).toEqual(DEFAULT_MARKER_LETTERS);
    expect(markerLetters({ duty: 'CI', vehicle: 'bad!', other: 'X' })).toEqual({ ...DEFAULT_MARKER_LETTERS, duty: 'CI' });
  });

  it('checks changes: one or two capitals or digits, no repeats, never F or M; blank goes back to the default', () => {
    expect(parseMarkerLetters({ duty: 'ci', vehicle: 'c' }, DEFAULT_MARKER_LETTERS)).toEqual({
      store: { duty: 'CI', vehicle: 'C' }, letters: { ...DEFAULT_MARKER_LETTERS, duty: 'CI', vehicle: 'C' },
    });
    expect(parseMarkerLetters({ duty: '' }, { ...DEFAULT_MARKER_LETTERS, duty: 'CI' })).toEqual({ store: {}, letters: DEFAULT_MARKER_LETTERS });
    expect(parseMarkerLetters({ duty: 'ABC' }, DEFAULT_MARKER_LETTERS)).toEqual({ error: 'The letter for duties must be one or two letters or numbers' });
    expect(parseMarkerLetters({ items: 'F' }, DEFAULT_MARKER_LETTERS)).toEqual({ error: 'F and M are kept for gender. Choose another letter for {items}' });
    expect(parseMarkerLetters({ items: 'E' }, DEFAULT_MARKER_LETTERS)).toEqual({ error: "{Equipment} and {items} can't both be E" });
    expect(parseMarkerLetters({ colour: 'Q' }, DEFAULT_MARKER_LETTERS)).toEqual({ error: 'There is no letter for colour' });
    expect(parseMarkerLetters('D', DEFAULT_MARKER_LETTERS)).toEqual({ error: 'Letters must be a list of kinds and letters' });
  });
});

describe('the Template tab: editing a template as a week', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  let site: string, otherSite: string, kitchen: string, otherArea: string, ana: string, gone: string, tpl: string, code: string, duty: string;

  beforeAll(async () => {
    db = await createTestDatabase('crop_template_edit');
    idp = await startFakeIdp('aud');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cafe','Demo Cafe'),('other','Other') returning id, slug`);
    const tenantId = t.rows.find(r => r.slug === 'cafe')!.id;
    const otherId = t.rows.find(r => r.slug === 'other')!.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'admin@x.com','admin'),($1,'alloc@x.com','allocator'),($1,'w@x.com','worker'),($2,'o@x.com','owner')`, [tenantId, otherId]);
    await owner.end();
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
    kitchen = (await http().post(`/facilities/${site}/areas`).set(as('admin')).send({ name: 'Kitchen' }).expect(201)).body.id;
    otherSite = (await http().post('/facilities').set(as('admin')).send({ name: 'Second', state: 'VIC' }).expect(201)).body.id;
    otherArea = (await http().post(`/facilities/${otherSite}/areas`).set(as('admin')).send({ name: 'Bar' }).expect(201)).body.id;
    ana = (await http().post('/workers').set(as('admin')).send({ firstName: 'Ana', lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id;
    await http().put(`/workers/${ana}/right-to-work`).set(as('admin')).send({ status: 'citizen', citizenProofType: 'au_passport' }).expect(200);
    await http().post(`/workers/${ana}/right-to-work/verify`).set(as('admin')).send({}).expect(201);
    gone = (await http().post('/workers').set(as('admin')).send({ firstName: 'Gus', lastName: 'Example', roles: ['Chef'] }).expect(201)).body.id;
    await http().patch(`/workers/${gone}`).set(as('admin')).send({ status: 'inactive' }).expect(200);
    code = (await http().post('/shift-codes').set(as('admin')).send({ code: 'AM', startTime: '06:00', endTime: '14:00', breakMinutes: 30 }).expect(201)).body.id;
    duty = (await http().post('/shift-duties').set(as('admin')).send({ name: 'Opens up' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('starts an empty template and adds shifts to several days at once', async () => {
    const r = await http().post('/roster/templates').set(as('alloc')).send({ facilityId: site, name: 'Ideal week', empty: true }).expect(201);
    expect(r.body).toMatchObject({ name: 'Ideal week', shifts: 0 });
    tpl = r.body.id;
    await http().post(`/roster/templates/${tpl}/shifts`).set(as('worker')).send({ weekdays: [1], role: 'Chef', startTime: '07:00', endTime: '15:00' }).expect(403);
    const add = await http().post(`/roster/templates/${tpl}/shifts`).set(as('alloc'))
      .send({ weekdays: [1, 2, 3], role: 'Chef', shiftCodeId: code, areaId: kitchen, workerId: ana, dutyIds: [duty] }).expect(201);
    expect(add.body.ids).toHaveLength(3);
    expect(add.body.shiftList.map((s: { weekday: number; startTime: string; endTime: string; breakMinutes: number; areaName: string; workerName: string; duties: { name: string }[] }) =>
      [s.weekday, s.startTime, s.endTime, s.breakMinutes, s.areaName, s.workerName, s.duties.map(d => d.name)]))
      .toEqual([1, 2, 3].map(d => [d, '06:00', '14:00', 30, 'Kitchen', 'Ana Example', ['Opens up']]));
    expect(add.body).toMatchObject({ shifts: 3, withPeople: 3 });
  });

  it('refuses what does not fit: no day, another site\'s area, an inactive person, no times', async () => {
    const bad = (body: Record<string, unknown>) => http().post(`/roster/templates/${tpl}/shifts`).set(as('alloc')).send(body).expect(400);
    expect((await bad({ weekdays: [], role: 'Chef', startTime: '07:00', endTime: '15:00' })).body.message).toBe('Choose at least one day, Monday to Sunday');
    expect((await bad({ weekdays: [4], role: 'Chef', startTime: '07:00', endTime: '15:00', areaId: otherArea })).body.message).toBe('Choose an area at this site');
    expect((await bad({ weekdays: [4], role: 'Chef', startTime: '07:00', endTime: '15:00', workerId: gone })).body.message).toBe('Choose a usual person who is active');
    expect((await bad({ weekdays: [4], role: 'Chef' })).body.message).toBe('Choose a shift type, or enter start and end times');
  });

  it('changes a shift as a new row that replaces the old one, and removes one', async () => {
    const before = (await http().get(`/roster/templates/${tpl}`).set(as('alloc')).expect(200)).body.shiftList;
    const mon = before[0];
    const r = await http().put(`/roster/template-shifts/${mon.id}`).set(as('alloc'))
      .send({ weekday: 1, role: 'Cook', startTime: '08:00', endTime: '16:00', breakMinutes: 0, workerId: null }).expect(200);
    expect(r.body.shiftId).not.toBe(mon.id);
    const changed = r.body.shiftList.find((s: { id: string }) => s.id === r.body.shiftId);
    expect(changed).toMatchObject({ weekday: 1, role: 'Cook', startTime: '08:00', workerId: null, duties: [] });
    // The old row is gone from the template; changing it again is refused.
    expect(r.body.shiftList.some((s: { id: string }) => s.id === mon.id)).toBe(false);
    await http().put(`/roster/template-shifts/${mon.id}`).set(as('alloc')).send({ weekday: 1, role: 'Cook', startTime: '08:00', endTime: '16:00' }).expect(404);
    const removed = await http().post(`/roster/template-shifts/${before[2].id}/remove`).set(as('alloc')).expect(200);
    expect(removed.body.shifts).toBe(2);
    await http().post(`/roster/template-shifts/${before[2].id}/remove`).set(as('alloc')).expect(404);
    // Nothing was deleted: the old rows stay on record.
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const rows = (await owner.query(`select count(*)::int as n, count(removed_at)::int as removed, count(replaces_id)::int as replacing from roster_template_shifts where template_id = $1`, [tpl])).rows[0];
    await owner.end();
    expect(rows).toEqual({ n: 4, removed: 2, replacing: 1 });
  });

  it('crop_app can only mark template shifts removed, never change what they say', async () => {
    const app2 = new Client({ connectionString: db.appUrl });
    await app2.connect();
    await expect(app2.query(`update roster_template_shifts set role = 'X'`)).rejects.toThrow(/permission denied/);
    await expect(app2.query(`delete from roster_template_shifts`)).rejects.toThrow(/permission denied/);
    await app2.end();
  });

  it('fills a week from the edited template only', async () => {
    const r = await http().post(`/roster/templates/${tpl}/apply`).set(as('alloc')).send({ weekStart: WEEK }).expect(200);
    expect(r.body).toMatchObject({ created: 2, assigned: 1 });
    const shifts = (await http().get(`/roster?from=${WEEK}&to=2031-08-10&facilityId=${site}`).set(as('alloc')).expect(200)).body.shifts;
    expect(shifts.map((s: { localDate: string; localStart: string; role: string; usualName: string | null }) => [s.localDate, s.localStart, s.role, s.usualName]))
      .toEqual([['2031-08-04', '08:00', 'Cook', null], ['2031-08-05', '06:00', 'Chef', 'Ana Example']]);
  });

  it('renames, refusing a name already used at the site', async () => {
    await http().post('/roster/templates').set(as('alloc')).send({ facilityId: site, name: 'Quiet week', empty: true }).expect(201);
    expect((await http().patch(`/roster/templates/${tpl}`).set(as('alloc')).send({ name: 'quiet WEEK' }).expect(409)).body.message)
      .toBe('There is already a template called quiet WEEK for this site');
    expect((await http().patch(`/roster/templates/${tpl}`).set(as('alloc')).send({ name: 'Busy week' }).expect(200)).body.name).toBe('Busy week');
  });

  it('another business sees and changes nothing', async () => {
    const shiftId = (await http().get(`/roster/templates/${tpl}`).set(as('alloc')).expect(200)).body.shiftList[0].id;
    await http().get(`/roster/templates/${tpl}`).set(as('other')).expect(404);
    await http().patch(`/roster/templates/${tpl}`).set(as('other')).send({ name: 'Mine' }).expect(404);
    await http().post(`/roster/templates/${tpl}/shifts`).set(as('other')).send({ weekdays: [1], role: 'Chef', startTime: '07:00', endTime: '15:00' }).expect(404);
    await http().put(`/roster/template-shifts/${shiftId}`).set(as('other')).send({ weekday: 1, role: 'Chef', startTime: '07:00', endTime: '15:00' }).expect(404);
    await http().post(`/roster/template-shifts/${shiftId}/remove`).set(as('other')).expect(404);
  });

  it('a put-away template can no longer be changed', async () => {
    await http().post(`/roster/templates/${tpl}/archive`).set(as('alloc')).expect(200);
    await http().post(`/roster/templates/${tpl}/shifts`).set(as('alloc')).send({ weekdays: [1], role: 'Chef', startTime: '07:00', endTime: '15:00' }).expect(404);
  });

  it('owners and admins change the letters on roster cards; everyone in the office reads them', async () => {
    expect((await http().get('/settings').set(as('alloc')).expect(200)).body.markerLetters).toEqual(DEFAULT_MARKER_LETTERS);
    await http().patch('/settings').set(as('alloc')).send({ markerLetters: { duty: 'CI' } }).expect(403);
    const r = await http().patch('/settings').set(as('admin')).send({ markerLetters: { duty: 'ci', vehicle: 'C' } }).expect(200);
    expect(r.body.markerLetters).toEqual({ ...DEFAULT_MARKER_LETTERS, duty: 'CI', vehicle: 'C' });
    expect((await http().patch('/settings').set(as('admin')).send({ markerLetters: { items: 'CI' } }).expect(400)).body.message).toBe("Duties and items can't both be CI");
    // Other settings leave the letters alone; blank resets one.
    await http().patch('/settings').set(as('admin')).send({ minRestHours: 9 }).expect(200);
    expect((await http().patch('/settings').set(as('admin')).send({ markerLetters: { vehicle: '' } }).expect(200)).body.markerLetters)
      .toEqual({ ...DEFAULT_MARKER_LETTERS, duty: 'CI' });
    expect((await http().get('/settings').set(as('other')).expect(200)).body.markerLetters).toEqual(DEFAULT_MARKER_LETTERS);
  });
});
