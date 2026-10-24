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

  it('sends the office one digest of what needs following up', async () => {
    const digest = (await sent()).filter(m => m.template === 'compliance_expiry');
    expect(digest).toHaveLength(1);
    expect(digest[0].to_address).toBe('office@x.com');
    expect(digest[0].body).toContain('Priyanka Sharma: CPR expires 27 November 2026 (25 days)');
    expect(digest[0].body).toContain('Priyanka Sharma: vaccination record expires 7 November 2026 (5 days)');
    expect(digest[0].body).toContain('Priyanka Sharma: Manual handling expired 31 October 2026');
    expect(digest[0].body).not.toContain('CPR expired');
    expect(digest[0].body).not.toContain('visa'); // 50 days away
    expect(digest[0].body).toContain('https://staging.cropwms.com/compliance');
  });

  it('never sends the same reminder twice', async () => {
    const before = (await sent()).length;
    await reminders.runOnce(at(15));
    await reminders.runOnce(at(9, addDays(TODAY, 1))); // next day: nothing new has crossed a stage
    expect((await sent()).length).toBe(before);
  });

  it('moves to the next stage as the date gets closer', async () => {
    await reminders.runOnce(at(9, addDays(TODAY, 20))); // CPR now 5 days away
    const cpr = (await sent()).filter(m => m.template === 'credential_expiry' && /CPR/.test(m.body));
    expect(cpr.map(m => m.channel).sort()).toEqual(['email', 'email', 'sms']);
  });
});
