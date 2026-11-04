import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@crop/db/dist/testing.js';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure.js';
import { deleteOrder, environmentRefusal, tenantRefusal } from '../src/demo/demo-cleanup.js';
import { DemoRefusal, demoDay } from '../src/demo/demo-day.js';
import { localToUtc, localDateOf, periodOf } from '../src/demo/demo-time.js';
import { startFakeIdp } from './fake-idp.js';

describe('demo-day seed: rules', () => {
  it('only runs for the demo business, on staging, never on a managed database', () => {
    expect(tenantRefusal('cfy')).toBeNull();
    expect(tenantRefusal('acme')).toMatch(/only runs for cfy/);
    expect(environmentRefusal({ DATABASE_URL: 'postgres://crop:x@postgres:5432/crop' })).toMatch(/CROP_ENV=staging/);
    expect(environmentRefusal({ CROP_ENV: 'production', DATABASE_URL: 'postgres://crop:x@postgres:5432/crop' })).toMatch(/CROP_ENV=staging/);
    expect(environmentRefusal({ CROP_ENV: 'staging', DATABASE_URL: 'postgres://u:p@db-postgresql-syd1-1.b.db.ondigitalocean.com:25060/crop' })).toMatch(/managed database/);
    expect(environmentRefusal({ CROP_ENV: 'staging' })).toMatch(/DATABASE_URL/);
    expect(environmentRefusal({ CROP_ENV: 'staging', DATABASE_URL: 'postgres://crop:x@postgres:5432/crop' })).toBeNull();
  });

  it('deletes a table before anything it points at', () => {
    const order = deleteOrder(['shifts', 'facilities', 'shift_assignments', 'workers', 'employment_terms'], [
      { child: 'shifts', parent: 'facilities' }, { child: 'shift_assignments', parent: 'shifts' }, { child: 'shift_assignments', parent: 'workers' },
      { child: 'employment_terms', parent: 'workers' }, { child: 'employment_terms', parent: 'employment_terms' },
    ]);
    expect(order.indexOf('shift_assignments')).toBeLessThan(order.indexOf('shifts'));
    expect(order.indexOf('shifts')).toBeLessThan(order.indexOf('facilities'));
    expect(order.indexOf('employment_terms')).toBeLessThan(order.indexOf('workers'));
    expect(() => deleteOrder(['a', 'b'], [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }])).toThrow(/point at each other/);
  });

  it('works in local times across daylight saving', () => {
    expect(localToUtc('2026-11-04', '07:00', 'Australia/Melbourne').toISOString()).toBe('2026-11-03T20:00:00.000Z');
    expect(localToUtc('2026-11-04', '07:00', 'Australia/Brisbane').toISOString()).toBe('2026-11-03T21:00:00.000Z');
    expect(localToUtc('2026-06-04', '07:00', 'Australia/Melbourne').toISOString()).toBe('2026-06-03T21:00:00.000Z');
    expect(localDateOf(new Date('2026-11-03T20:00:00Z'), 'Australia/Melbourne')).toBe('2026-11-04');
    expect([periodOf('07:00'), periodOf('13:00'), periodOf('21:30'), periodOf('04:59')]).toEqual(['am', 'pm', 'night', 'night']);
  });
});

describe('demo-day seed: database and Allocations', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let owner: Client;
  let app: INestApplication;
  let idp: Awaited<ReturnType<typeof startFakeIdp>>;
  let tok = '';
  const ids: Record<string, string> = {};
  const count = async (sql: string, params: unknown[] = []) => (await owner.query<{ n: number }>(sql, params)).rows[0].n;
  const otherCounts = () => owner.query(`select (select count(*) from workers where tenant_id = $1)::int as w, (select count(*) from shifts where tenant_id = $1)::int as s,
    (select count(*) from facilities where tenant_id = $1)::int as f, (select count(*) from audit_log where tenant_id = $1)::int as a`, [ids.other]).then(r => r.rows[0]);

  beforeAll(async () => {
    db = await createTestDatabase('crop_demo_day');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    const t = await owner.query<{ id: string; slug: string }>(`insert into tenants(slug, name) values ('cfy', 'Caring Example'), ('other', 'Other Business') returning id, slug`);
    for (const r of t.rows) ids[r.slug] = r.id;
    // Another business with a little data (and audit rows), which the reset must never touch.
    await owner.query(`insert into tenant_settings(tenant_id) values ($1), ($2)`, [ids.cfy, ids.other]);
    const f = await owner.query<{ id: string }>(`insert into facilities(tenant_id, name) values ($1, 'Their Site') returning id`, [ids.other]);
    await owner.query(`insert into workers(tenant_id, first_name, last_name, email, phone) values ($1, 'Their', 'Person', 'them@realmail.test.au', '+61400000000')`, [ids.other]);
    await owner.query(`insert into shifts(tenant_id, facility_id, role, starts_at, ends_at) values ($1, $2, 'Cook', now() + interval '1 day', now() + interval '1 day 8 hours')`, [ids.other, f.rows[0].id]);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1, 'boss@x.com', 'owner')`, [ids.cfy]);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await owner?.end();
    await db?.drop();
  });

  it('refuses another business, and holds back when anything looks real', async () => {
    await expect(demoDay(owner, { slug: 'other', confirm: 'RESET' })).rejects.toThrow(DemoRefusal);
    const w = await owner.query<{ id: string }>(`insert into workers(tenant_id, first_name, last_name, email) values ($1, 'Real', 'Looking', 'someone@gmail.com') returning id`, [ids.cfy]);
    await expect(demoDay(owner, { slug: 'cfy', confirm: 'RESET' })).rejects.toThrow(/may be real/);
    await owner.query('delete from workers where id = $1', [w.rows[0].id]);
  });

  it('only reports without RESET', async () => {
    const before = await count('select count(*)::int as n from shifts');
    const r = await demoDay(owner, { slug: 'cfy' });
    expect(r.dryRun).toBe(true);
    expect(await count('select count(*)::int as n from shifts')).toBe(before);
    expect(await count('select count(*)::int as n from users')).toBe(0);
  });

  it('deletes real-looking test entries only when told to, keeping real sign-ins', async () => {
    // David's own test entries (4 Nov): a person with a real-looking email linked to his sign-in, a client and a site with phones.
    const u = await owner.query<{ id: string }>(`insert into users(idp_subject, email) values ('david-real', 'david@gmail.com') returning id`);
    ids.realUser = u.rows[0].id;
    await owner.query(`insert into memberships(tenant_id, user_id, role) values ($1, $2, 'owner')`, [ids.cfy, ids.realUser]);
    await owner.query(`insert into workers(tenant_id, first_name, last_name, email, user_id) values ($1, 'David', 'Bee', 'david@gmail.com', $2)`, [ids.cfy, ids.realUser]);
    const c = await owner.query<{ id: string }>(`insert into clients(tenant_id, name, phone) values ($1, 'Sample Client', '03 9000 0000') returning id`, [ids.cfy]);
    await owner.query(`insert into facilities(tenant_id, name, phone, client_id) values ($1, 'Sample Site', '03 9000 0001', $2)`, [ids.cfy, c.rows[0].id]);
    await expect(demoDay(owner, { slug: 'cfy', confirm: 'RESET' })).rejects.toThrow(/may be real[\s\S]*--delete-real-looking/);
    const dry = await demoDay(owner, { slug: 'cfy', deleteRealLooking: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.realLooking).toHaveLength(3);
    expect(await count(`select count(*)::int as n from workers where tenant_id = $1`, [ids.cfy])).toBe(1);
    // The other checks still apply with the override.
    await expect(demoDay(owner, { slug: 'other', confirm: 'RESET', deleteRealLooking: true })).rejects.toThrow(/only runs for cfy/);
  });

  it('seeds a busy day, re-runs cleanly and leaves other businesses alone', async () => {
    const other = await otherCounts();
    const lines: string[] = [];
    const first = await demoDay(owner, { slug: 'cfy', confirm: 'RESET', deleteRealLooking: true, log: l => lines.push(l) });
    expect(first.dryRun).toBe(false);
    expect(first.realLooking).toHaveLength(3);
    expect(first.removed).toMatchObject({ workers: 1, clients: 1, facilities: 1 });
    expect(lines.join('\n')).toMatch(/Deleting records that may be real[\s\S]*deleted 1 workers/);
    expect(lines.join('\n')).toMatch(/\(today\): \d+/);
    expect(await count(`select count(*)::int as n from workers where tenant_id = $1 and email = 'david@gmail.com'`, [ids.cfy])).toBe(0);
    // His sign-in and access stay.
    expect(await count(`select count(*)::int as n from memberships where tenant_id = $1 and user_id = $2`, [ids.cfy, ids.realUser])).toBe(1);
    expect(await count(`select count(*)::int as n from users where id = $1`, [ids.realUser])).toBe(1);
    const shifts = await count('select count(*)::int as n from shifts where tenant_id = $1', [ids.cfy]);
    expect(shifts).toBeGreaterThan(2500);
    const today = await count(`select count(*)::int as n from shifts s join facilities f on f.id = s.facility_id
      where s.tenant_id = $1 and (s.starts_at at time zone f.timezone)::date = $2::date`, [ids.cfy, first.day]);
    expect(today).toBeGreaterThan(180);
    expect(await count(`select count(*)::int as n from workers where tenant_id = $1 and status = 'active'`, [ids.cfy])).toBeGreaterThan(300);
    expect(await count(`select count(*)::int as n from clients where tenant_id = $1`, [ids.cfy])).toBe(15);
    expect(await count(`select count(*)::int as n from offices where tenant_id = $1`, [ids.cfy])).toBe(5);

    // Nothing reaches a real person: example addresses only, no phones, nothing queued, no client email due.
    expect(await count(`select count(*)::int as n from workers where tenant_id = $1 and (phone is not null or email not like '%@example.com')`, [ids.cfy])).toBe(0);
    expect(await count(`select count(*)::int as n from client_contacts where tenant_id = $1 and (phone is not null or email not like '%@example.com')`, [ids.cfy])).toBe(0);
    expect(await count(`select count(*)::int as n from notifications where tenant_id = $1 and (status in ('queued', 'sending') or to_address not like '%@example.com')`, [ids.cfy])).toBe(0);
    expect(await count(`select count(*)::int as n from app_client_confirmations_due(500) where tenant_id = $1`, [ids.cfy])).toBe(0);
    expect(await count(`select count(*)::int as n from app_client_notices_due(0, 500) where tenant_id = $1`, [ids.cfy])).toBe(0);
    expect(await count(`select count(*)::int as n from pg_trigger where not tgisinternal and tgenabled = 'D'`)).toBe(0);

    // History the live numbers read: officers' changes, offers, calls and messages; cancellations by kind; pull-outs.
    expect(await count(`select count(distinct actor_id)::int as n from shift_changes where tenant_id = $1 and via = 'office'`, [ids.cfy])).toBe(7);
    expect(await count(`select count(*)::int as n from call_logs where tenant_id = $1`, [ids.cfy])).toBeGreaterThan(100);
    expect(await count(`select count(distinct cancel_kind)::int as n from shifts where tenant_id = $1`, [ids.cfy])).toBeGreaterThanOrEqual(4);
    expect(await count(`select count(*)::int as n from shift_assignments where tenant_id = $1 and removed_reason = 'pulled_out'`, [ids.cfy])).toBeGreaterThan(20);
    expect(await count(`select count(*)::int as n from shifts where tenant_id = $1 and usual_worker_id is not null`, [ids.cfy])).toBeGreaterThan(20);
    expect(await count(`select count(*)::int as n from day_requests where tenant_id = $1 and status = 'open'`, [ids.cfy])).toBeGreaterThan(10);
    // A small share of past shifts ended with nobody: some never filled, some pulled out and not refilled.
    const pastShifts = await count(`select count(*)::int as n from shifts where tenant_id = $1 and ends_at <= now() and status <> 'cancelled'`, [ids.cfy]);
    const unfilled = await count(`select count(*)::int as n from shifts where tenant_id = $1 and ends_at <= now() and status = 'open'`, [ids.cfy]);
    expect(unfilled).toBeGreaterThan(20);
    expect(unfilled / pastShifts).toBeLessThan(0.08);
    expect(await count(`select count(*)::int as n from shifts s where tenant_id = $1 and ends_at <= now() and status = 'open'
      and exists (select 1 from shift_assignments a where a.shift_id = s.id and a.removed_reason = 'pulled_out')`, [ids.cfy])).toBeGreaterThan(3);

    const again = await demoDay(owner, { slug: 'cfy', confirm: 'RESET' });
    expect(again.removed.shifts).toBe(shifts);
    expect(await count(`select count(*)::int as n from users where idp_subject like 'demo-day:cfy:%'`)).toBe(7);
    expect(await count(`select count(*)::int as n from memberships where tenant_id = $1`, [ids.cfy])).toBe(8);
    expect(await count(`select count(*)::int as n from industry_pack_applications where tenant_id = $1`, [ids.cfy])).toBe(2);
    expect(await otherCounts()).toEqual(other);
  }, 120_000);

  it('gives the Allocations queue every stage and band', async () => {
    idp = await startFakeIdp('aud');
    idp.addUser({ sub: 'boss', email: 'boss@x.com', email_verified: true });
    tok = await idp.token('boss', { expiresIn: '1h' });
    Object.assign(process.env, { APP_DATABASE_URL: db.appUrl, AUTH_ISSUER: idp.issuer, AUTH_AUDIENCE: 'aud' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    const http = () => request(app.getHttpServer());
    const q = (await http().get('/allocations/queue?days=3&office=all').set({ authorization: `Bearer ${tok}` }).expect(200)).body as {
      counts: Record<string, number>; bands: Record<string, number>; offices: { name: string }[]; shifts: { id: string; stage: string }[] };
    for (const k of ['new', 'released', 'accepted', 'pulled_out', 'client_to_confirm', 'booked_today']) expect(q.counts[k], k).toBeGreaterThan(0);
    expect(q.counts.all).toBeGreaterThan(150);
    expect(q.bands.started + q.bands.soon).toBeGreaterThan(3);
    expect(q.offices.map(o => o.name)).toContain('QLD Sunshine Coast');
    // The outcome tabs have unfilled history (the current or the previous month holds the 14 days before today).
    let unfilled = 0;
    for (const period of ['month', 'prev_month']) {
      const p = (await http().get(`/allocations/queue?period=${period}&office=all&stage=unfilled`).set({ authorization: `Bearer ${tok}` }).expect(200)).body as {
        counts: Record<string, number> };
      unfilled += p.counts.unfilled ?? 0;
    }
    expect(unfilled).toBeGreaterThan(20);
    // Best people know who has worked at the site before.
    const released = q.shifts.find(s => s.stage === 'released')!;
    const fill = (await http().get(`/shifts/${released.id}/bank-fill?everyone=true`).set({ authorization: `Bearer ${tok}` }).expect(200)).body as {
      candidates: { siteHistory: { shiftsHere: number } }[] };
    expect(fill.candidates.some(c => c.siteHistory.shiftsHere > 0)).toBe(true);
    const live = (await http().get('/dashboard/live?period=last7').set({ authorization: `Bearer ${tok}` }).expect(200)).body;
    expect(JSON.stringify(live)).toContain('Nadia Haddad');
  }, 60_000);
});
