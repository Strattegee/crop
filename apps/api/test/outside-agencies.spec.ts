import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { outsideAgencyEmail, outsideProblem, outsideRequirements } from '../src/agencies/outside.js';
import { startFakeIdp } from './fake-idp.js';

describe('agencies not on CROP: what the email lists (David, 29 Oct)', () => {
  it('puts the role’s rules under standard and the shift’s extra ones under special, each once at its strongest level', () => {
    const r = outsideRequirements([
      { name: 'Police check', severity: 'hard', forDuty: null },
      { name: 'First aid', severity: 'warning', forDuty: null },
      { name: 'Barista course', severity: 'optional', forDuty: null },
      { name: 'First aid', severity: 'hard', forDuty: 'Pool supervision' },   // needed more strongly for this shift
      { name: 'Police check', severity: 'warning', forDuty: 'Night float' },  // the role already needs it more
      { name: 'Forklift licence', severity: 'hard', forDuty: 'Forklift operator' },
      { name: 'Forklift licence', severity: 'warning', forDuty: 'Loading dock' },
    ]);
    expect(r.standard.map(x => [x.name, x.levelWords])).toEqual([['Police check', 'Must have'], ['Barista course', 'Optional']]);
    expect(r.special.map(x => [x.name, x.levelWords, x.forWhat])).toEqual([
      ['First aid', 'Must have', 'Pool supervision'], ['Forklift licence', 'Must have', 'Forklift operator, Loading dock']]);
  });

  it('writes the email with the shift, both sections and who to reply to, no people', () => {
    const { subject, body } = outsideAgencyEmail({
      businessName: 'Bayside Hospital', siteName: 'Bayside Campus', siteTimezone: 'Australia/Melbourne', areaName: 'Ward 3', role: 'Nurse',
      startsAt: new Date('2026-11-02T20:00:00Z'), endsAt: new Date('2026-11-03T04:30:00Z'), breakMinutes: 30, duties: ['Medication round'], genderRequested: 'F',
    }, outsideRequirements([{ name: 'Nursing registration', severity: 'hard', forDuty: null }, { name: 'Medication competency', severity: 'warning', forDuty: 'Medication round' }]),
    { agencyName: 'Northside Staffing', note: 'Ask for Sam at the desk', replyName: 'Pat Office', replyEmail: 'pat@bayside.example' });
    expect(subject).toBe('Bayside Hospital: Nurse on Tue 3 Nov');
    expect(body).toContain('Hello Northside Staffing,');
    expect(body).toContain('Nurse at Ward 3, Bayside Campus');
    expect(body).toContain('Tue 3 Nov, 7:00am to 3:30pm (30 minute break)');
    expect(body).toContain('Standard requirements for a Nurse:\n- Nursing registration: must have');
    expect(body).toContain('Special requirements for this shift:\n- Medication competency: ideal (for Medication round)\n- Duties on this shift: Medication round\n- A female worker requested');
    expect(body).toContain('Note from Bayside Hospital: Ask for Sam at the desk');
    expect(body).toContain('please reply to Pat Office at pat@bayside.example');
    // No special section when the shift adds nothing.
    const plain = outsideAgencyEmail({
      businessName: 'Bayside Hospital', siteName: 'Bayside Campus', siteTimezone: 'Australia/Melbourne', areaName: null, role: 'Nurse',
      startsAt: new Date('2026-11-02T20:00:00Z'), endsAt: new Date('2026-11-03T04:30:00Z'), breakMinutes: 0, duties: [], genderRequested: null,
    }, { standard: [], special: [] }, { agencyName: 'X', note: null, replyName: null, replyEmail: null });
    expect(plain.body).not.toContain('Special requirements');
    expect(plain.body).toContain('- None recorded');
    expect(plain.body).toContain('please contact Bayside Hospital');
  });

  it('says why a shift can’t be emailed', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    const open = { status: 'open', equipmentOnly: false, startsAt: new Date('2026-11-03T00:00:00Z') };
    expect(outsideProblem(open, 1, now)).toBeNull();
    expect(outsideProblem(open, 0, now)).toMatch(/Settings → Agencies/);
    expect(outsideProblem({ ...open, status: 'booked' }, 1, now)).toMatch(/Someone is already/);
    expect(outsideProblem({ ...open, startsAt: now }, 1, now)).toMatch(/already started/);
    expect(outsideProblem({ ...open, equipmentOnly: true }, 1, now)).toMatch(/equipment-only/);
  });
});

describe('agencies not on CROP: API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  const tok: Record<string, string> = {};
  const as = (w: string) => ({ authorization: `Bearer ${tok[w]}` });
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string> = {};
  let site: string;

  const newShift = async (hoursAhead: number) =>
    (await owner.query<{ id: string }>(
      `insert into shifts(tenant_id, facility_id, role, starts_at, ends_at) values ($1, $2, 'Nurse', now() + make_interval(hours => $3), now() + make_interval(hours => $3 + 8)) returning id`,
      [ids.bayside, site, hoursAhead])).rows[0].id;

  beforeAll(async () => {
    db = await createTestDatabase('crop_outside_agencies');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('bayside','Bayside Hospital'),('nosy','Nosy Staffing') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'emp@x.com','owner'),($1,'alloc@x.com','allocator'),($2,'nosy@x.com','owner')`, [ids.bayside, ids.nosy]);
    for (const [sub, email] of [['emp', 'emp@x.com'], ['alloc', 'alloc@x.com'], ['nosy', 'nosy@x.com']]) {
      idp.addUser({ sub, email, email_verified: true });
      tok[sub] = await idp.token(sub, { expiresIn: '1h' });
    }
    site = (await owner.query<{ id: string }>(`insert into facilities(tenant_id, name, timezone) values ($1, 'Bayside Campus', 'Australia/Melbourne') returning id`, [ids.bayside])).rows[0].id;
    const reg = (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category) values ($1, 'Nursing registration', 'registration') returning id`, [ids.bayside])).rows[0].id;
    const med = (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category) values ($1, 'Medication competency', 'training') returning id`, [ids.bayside])).rows[0].id;
    await owner.query(`insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity) values ($1,$2,'role','Nurse','hard')`, [ids.bayside, reg]);
    ids.duty = (await owner.query<{ id: string }>(`insert into shift_duties(tenant_id, name) values ($1, 'Medication round') returning id`, [ids.bayside])).rows[0].id;
    await owner.query(`insert into shift_duty_requirements(tenant_id, duty_id, credential_type_id, severity) values ($1,$2,$3,'warning')`, [ids.bayside, ids.duty, med]);
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await idp?.close();
    await db?.drop();
  });

  it('keeps a list of outside agencies (owners and admins), switched off but never deleted', async () => {
    await http().post('/outside-agencies').set(as('alloc')).send({ name: 'Northside Staffing', email: 'jobs@northside.example' }).expect(403);
    await http().post('/outside-agencies').set(as('emp')).send({ name: 'Northside Staffing', email: 'not an email' }).expect(400);
    const a = (await http().post('/outside-agencies').set(as('emp')).send({ name: 'Northside Staffing', email: 'Jobs@Northside.example', phone: '03 9000 0000' }).expect(201)).body;
    expect(a).toMatchObject({ name: 'Northside Staffing', email: 'jobs@northside.example', active: true });
    ids.north = a.id;
    await http().post('/outside-agencies').set(as('emp')).send({ name: 'northside staffing', email: 'x@y.example' }).expect(409);
    ids.east = (await http().post('/outside-agencies').set(as('emp')).send({ name: 'Eastern Care', email: 'shifts@eastern.example' }).expect(201)).body.id;
    const off = (await http().patch(`/outside-agencies/${ids.east}`).set(as('emp')).send({ active: false, phone: '' }).expect(200)).body;
    expect(off).toMatchObject({ active: false, phone: null });
    const list = (await http().get('/outside-agencies').set(as('alloc')).expect(200)).body;
    expect(list.map((x: { name: string; active: boolean }) => [x.name, x.active])).toEqual([['Northside Staffing', true], ['Eastern Care', false]]);
    // Another business sees none of them.
    expect((await http().get('/outside-agencies').set(as('nosy')).expect(200)).body).toEqual([]);
    await http().patch(`/outside-agencies/${ids.north}`).set(as('nosy')).send({ active: false }).expect(404);
    // Changes are in the audit log.
    expect((await owner.query(`select count(*)::int as n from audit_log where table_name = 'outside_agencies'`)).rows[0].n).toBe(3);
  });

  it('emails an open shift with its standard and special requirements, and logs it', async () => {
    const shift = await newShift(30);
    await owner.query(`insert into shift_duty_links(tenant_id, shift_id, duty_id) values ($1,$2,$3)`, [ids.bayside, shift, ids.duty]);
    const st = (await http().get(`/shifts/${shift}/outside-agencies`).set(as('alloc')).expect(200)).body;
    expect(st).toMatchObject({ canSend: true, problem: null, sent: [] });
    expect(st.agencies.map((x: { name: string }) => x.name)).toEqual(['Northside Staffing']); // switched-off ones aren't offered
    expect(st.requirements.standard).toEqual([{ name: 'Nursing registration', level: 'hard', levelWords: 'Must have', forWhat: null }]);
    expect(st.requirements.special).toEqual([{ name: 'Medication competency', level: 'warning', levelWords: 'Ideal', forWhat: 'Medication round' }]);

    await http().post(`/shifts/${shift}/outside-agencies`).set(as('alloc')).send({ agencyIds: [] }).expect(400);
    await http().post(`/shifts/${shift}/outside-agencies`).set(as('alloc')).send({ agencyIds: [ids.east] }).expect(400); // switched off
    await http().post(`/shifts/${shift}/outside-agencies`).set(as('nosy')).send({ agencyIds: [ids.north] }).expect(404);
    const after = (await http().post(`/shifts/${shift}/outside-agencies`).set(as('alloc')).send({ agencyIds: [ids.north], note: 'Ask for Sam' }).expect(200)).body;
    expect(after.sent).toHaveLength(1);
    expect(after.sent[0]).toMatchObject({ agencyName: 'Northside Staffing', toAddress: 'jobs@northside.example', note: 'Ask for Sam', delivery: 'queued' });
    const n = (await owner.query<{ to_address: string; template: string; subject: string; body: string }>(
      `select to_address, template, subject, body from notifications where template = 'outside_agency_request'`)).rows;
    expect(n).toHaveLength(1);
    expect(n[0].to_address).toBe('jobs@northside.example');
    expect(n[0].body).toContain('- Nursing registration: must have');
    expect(n[0].body).toContain('- Medication competency: ideal (for Medication round)');
    expect(n[0].body).toContain('please reply to');
    expect(n[0].body).toContain('alloc@x.com');
    // A second press straight away is refused.
    await http().post(`/shifts/${shift}/outside-agencies`).set(as('alloc')).send({ agencyIds: [ids.north] }).expect(409);
    // The shift itself didn't change.
    expect((await owner.query(`select status from shifts where id = $1`, [shift])).rows[0].status).toBe('open');
  });

  it('refuses shifts that are filled or started', async () => {
    const started = await newShift(-1);
    const st = (await http().get(`/shifts/${started}/outside-agencies`).set(as('alloc')).expect(200)).body;
    expect(st.problem).toMatch(/already started/);
    await http().post(`/shifts/${started}/outside-agencies`).set(as('alloc')).send({ agencyIds: [ids.north] }).expect(400);
  });
});
