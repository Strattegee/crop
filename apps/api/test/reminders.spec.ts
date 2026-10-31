import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { ExpiryReminders } from '../src/notifications/reminders.js';
import { EMAIL_SENDER, MemoryEmail, MemorySms, SMS_SENDER } from '../src/notifications/senders.js';
import { addDays } from '../src/workforce/compliance.js';
import { startFakeIdp } from './fake-idp.js';

// The agency runs on UTC in this test so "9am" and "today" are easy to state.
const TODAY = '2026-11-02';
const at = (hour: number, day = TODAY) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);

describe('expiry reminders', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let owner: Client;
  let reminders: ExpiryReminders;
  let tenantId = '';
  const http = () => request(app.getHttpServer());
  let adminToken = '';

  beforeAll(async () => {
    db = await createTestDatabase('crop_reminders');
    idp = await startFakeIdp('aud');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    tenantId = (await owner.query<{ id: string }>(`insert into tenants(slug, name) values ('cfy','Demo Agency') returning id`)).rows[0].id;
    await owner.query(`insert into tenant_settings(tenant_id, timezone) values ($1, 'UTC')`, [tenantId]);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'office@x.com','admin')`, [tenantId]);
    idp.addUser({ sub: 'admin', email: 'office@x.com', email_verified: true });
    adminToken = await idp.token('admin', { expiresIn: '1h' });
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud', APP_URL: 'https://staging.cropwms.com' });
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER).useValue(new MemoryEmail())
      .overrideProvider(SMS_SENDER).useValue(new MemorySms())
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    reminders = app.get(ExpiryReminders);
    await http().get('/me').set('authorization', `Bearer ${adminToken}`).expect(200); // office admin signs in once

    const w = (await owner.query<{ id: string }>(
      `insert into workers(tenant_id, first_name, last_name, preferred_name, email, phone) values ($1,'Priyanka','Sharma','Priya','priya@x.com','0412 345 678') returning id`, [tenantId],
    )).rows[0].id;
    const type = async (name: string, category: string) =>
      (await owner.query<{ id: string }>(`insert into credential_types(tenant_id, name, category) values ($1,$2,$3) returning id`, [tenantId, name, category])).rows[0].id;
    const cred = (typeId: string, expiry: string, verification = 'verified') =>
      owner.query(`insert into worker_credentials(tenant_id, worker_id, credential_type_id, expiry_date, verification) values ($1,$2,$3,$4,$5)`,
        [tenantId, w, typeId, expiry, verification]);
    const cpr = await type('CPR', 'training');
    const flu = await type('Influenza vaccination', 'vaccination');
    const police = await type('National Police Check', 'check');
    await cred(cpr, addDays(TODAY, 25));            // 30-day stage
    await cred(flu, addDays(TODAY, 5));             // 7-day stage
    await cred(police, addDays(TODAY, 10));         // renewed: a later one exists, so no reminder
    await cred(police, addDays(TODAY, 1000));
    await cred(cpr, addDays(TODAY, -2));            // an older CPR: superseded by the one above, so not reported
    await cred(await type('Manual handling', 'training'), addDays(TODAY, -2)); // expired, not renewed
    await owner.query(
      `insert into right_to_work_records(tenant_id, worker_id, status, visa_type, visa_subclass, visa_expiry, work_limit, vevo_checked_on, vevo_result)
       values ($1,$2,'visa_holder','Student','500',$3,'unlimited',$4,'confirmed')`, [tenantId, w, addDays(TODAY, 50), TODAY],
    );

    // Equipment: a forklift with a registration coming due and a service already overdue, booked on shifts after both.
    const site = (await owner.query<{ id: string }>(`insert into facilities(tenant_id, name, timezone) values ($1,'North Yard','Australia/Melbourne') returning id`, [tenantId])).rows[0].id;
    const ftype = (await owner.query<{ id: string }>(`insert into equipment_types(tenant_id, name) values ($1,'Forklift') returning id`, [tenantId])).rows[0].id;
    const machine = async (name: string, asset: string | null, status = 'active') =>
      (await owner.query<{ id: string }>(`insert into equipment(tenant_id, equipment_type_id, name, asset_number, status) values ($1,$2,$3,$4,$5) returning id`,
        [tenantId, ftype, name, asset, status])).rows[0].id;
    const check = (equipmentId: string, name: string, due: string, superseded = false) =>
      owner.query(`insert into equipment_checks(tenant_id, equipment_id, name, due_on, superseded_at) values ($1,$2,$3,$4,$5)`,
        [tenantId, equipmentId, name, due, superseded ? new Date() : null]);
    const fork = await machine('Forklift 2', 'FL-02');
    await check(fork, 'Registration', addDays(TODAY, 5), true);   // replaced by the next one, so not reported
    await check(fork, 'Registration', addDays(TODAY, 20));
    await check(fork, 'Service', addDays(TODAY, -3));             // overdue
    await check(await machine('Old forklift', null, 'retired'), 'Registration', addDays(TODAY, 10)); // retired: ignored
    const book = async (day: string, status = 'open') => {
      const s = (await owner.query<{ id: string }>(
        `insert into shifts(tenant_id, facility_id, role, starts_at, ends_at, status) values ($1,$2,'Operator',$3,$4,$5) returning id`,
        [tenantId, site, `${day}T21:00:00Z`, `${day}T23:00:00Z`, status])).rows[0].id; // 8am-10am Melbourne the next day
      await owner.query(`insert into shift_assignments(tenant_id, shift_id, resource_kind, equipment_id, status) values ($1,$2,'equipment',$3,'confirmed')`, [tenantId, s, fork]);
    };
    await book(addDays(TODAY, 9));                 // local date TODAY+10: after the service date only
    await book(addDays(TODAY, 24));                // local date TODAY+25: after both
    await book(addDays(TODAY, 25), 'cancelled');   // cancelled: not counted
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await idp?.close();
    await db?.drop();
  });

  const sent = async () => (await owner.query<{ channel: string; to_address: string; subject: string | null; body: string; template: string }>(
    `select channel, to_address, subject, body, template from notifications order by created_at, channel`)).rows;

  it('waits until 8am agency time', async () => {
    expect(await reminders.runOnce(at(7))).toBe(0);
  });

  it('reminds the worker at the right stage, with SMS only in the last week', async () => {
    await reminders.runOnce(at(9));
    const msgs = (await sent()).filter(m => m.template === 'credential_expiry');
    expect(msgs.map(m => `${m.channel}:${m.subject ?? m.body.slice(0, 40)}`).sort()).toEqual([
      'email:Your CPR expires on 27 November 2026',
      'email:Your vaccination record expires on 7 November 2026',
      'email:Your visa expires on 22 December 2026',
      'sms:Hi Priya, your vaccination record expire',
    ]);
    expect(msgs.find(m => m.channel === 'sms')!.to_address).toBe('+61412345678');
    // No health details: the vaccine isn't named; no reminder for the renewed police check.
    expect(msgs.some(m => /influenza|police/i.test(m.body))).toBe(false);
  });

  it('puts what needs following up in the office\'s daily dashboard email', async () => {
    const digest = (await sent()).filter(m => m.template === 'daily_dashboard');
    expect(digest).toHaveLength(1);
    expect(digest[0].to_address).toBe('office@x.com');
    expect(digest[0].body).toContain('Priyanka Sharma: CPR expires 27 November 2026 (25 days)');
    expect(digest[0].body).toContain('Priyanka Sharma: vaccination record expires 7 November 2026 (5 days)');
    expect(digest[0].body).toContain('Priyanka Sharma: Manual handling expired 31 October 2026');
    expect(digest[0].body).not.toContain('CPR expired');
    expect(digest[0].body).not.toContain('visa'); // 50 days away
    expect(digest[0].body).toContain('Dates to follow up:');
    expect(digest[0].body).toContain('https://staging.cropwms.com/dashboard');
    expect(digest[0].body).toContain('Overview dashboard');
  });

  it('includes equipment dates in the email, with bookings that fall after them', async () => {
    const body = (await sent()).find(m => m.template === 'daily_dashboard')!.body;
    expect(body).toContain('People:\n- Priyanka Sharma');
    expect(body).toContain('Equipment:\n');
    expect(body).toContain('- Forklift 2 (FL-02): Service was due 30 October 2026 (overdue); booked on 2 shifts after that date');
    expect(body).toContain('- Forklift 2 (FL-02): Registration is due 22 November 2026 (20 days); booked on 1 shift after that date');
    expect(body).not.toContain('7 November 2026 (5 days); booked'); // the replaced registration date
    expect(body).not.toContain('Old forklift');
  });

  it('never sends the same reminder twice', async () => {
    const before = (await sent()).length;
    const reminded = (await sent()).filter(m => m.template === 'credential_expiry').length;
    await reminders.runOnce(at(15)); // later the same day: nothing
    expect((await sent()).length).toBe(before);
    await reminders.runOnce(at(9, addDays(TODAY, 1))); // next day: nothing new has crossed a stage
    const after = await sent();
    expect(after.filter(m => m.template === 'credential_expiry')).toHaveLength(reminded);
    // Any email the next day (shifts may need attention by then) carries no dates already reported.
    expect(after.slice(before).every(m => m.template === 'daily_dashboard' && !m.body.includes('Dates to follow up'))).toBe(true);
  });

  it('moves to the next stage as the date gets closer', async () => {
    await reminders.runOnce(at(9, addDays(TODAY, 20))); // CPR now 5 days away
    const cpr = (await sent()).filter(m => m.template === 'credential_expiry' && /CPR/.test(m.body));
    expect(cpr.map(m => m.channel).sort()).toEqual(['email', 'email', 'sms']);
    // The forklift's registration is due that day.
    const digests = (await sent()).filter(m => m.template === 'daily_dashboard');
    expect(digests.at(-1)!.body).toContain('- Forklift 2 (FL-02): Registration is due today; booked on 1 shift after that date');
  });
});
