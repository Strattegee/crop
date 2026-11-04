/**
 * The demo-day seed (David and Steve, 3 Nov 2026): resets one staging business (Caring For You, `cfy`) and fills it
 * with an invented but realistic agency day, so they can work the Allocations screen "like a normal day" in a meeting.
 *
 * Runs as the database owner in one transaction: checks it is safe, deletes the business's data (keeping the
 * business, its sign-ins, settings, words and set-up), then writes offices, clients, sites, people with their
 * records, 14 days of history, today and the next 3 days, all relative to `day` and the real clock. Triggers are
 * switched off while it writes (they would stamp everything "now" and log the seed itself); the change log, call log
 * and messages it needs are written directly with past times. Nothing is queued to send: messages are history rows,
 * and every booked shift's client email is recorded as already sent. Run it with `demo-day-cli.ts`.
 */
import { randomUUID } from 'node:crypto';
import type { ClientBase } from 'pg';
import { packById } from '../industry/packs.js';
import { applyPack } from '../industry/apply-pack.js';
import {
  CALL_NOTES_WORKER, CLIENTS, DAY_REQUEST_NOTES, FIRST_F, FIRST_M, OFFICERS, OFFICES, ORDER_NOTES, OFFICER_SUBJECT, ROLE_GROUPS,
  HOME_PLACES, HOME_STREETS, SLOTS, SURNAMES, WEEKEND, WORKER_NOTES, officerEmail, type AreaKind, type ClientDef, type SiteDef,
} from './demo-data.js';
import { DemoRefusal, planCleanup, realLookingData, runCleanup, tenantRefusal, triggerTables } from './demo-cleanup.js';
import { addDays, daysBetween, localDateOf, localTimeOf, localToUtc, mondayOf, periodOf, seededRandom, weekdayOf } from './demo-time.js';

export { DemoRefusal } from './demo-cleanup.js';

export interface DemoOptions {
  slug: string;
  /** The demo's "today" (YYYY-MM-DD in the business's time zone); default today. */
  day?: string;
  /** Must be RESET to change anything; otherwise a dry run that only reports. */
  confirm?: string;
  /**
   * Delete records that look real (a non-example email or a phone number) along with everything else, instead of
   * refusing (David, 4 Nov: his own test entries in cfy). Every other safety check still applies.
   */
  deleteRealLooking?: boolean;
  /** The clock (tests). */
  now?: Date;
  log?: (line: string) => void;
}

export interface DemoResult {
  dryRun: boolean; tenantId: string; day: string; removed: Record<string, number>; created: Record<string, number>;
  /** What looked real and was (or, in a dry run, would be) deleted because `deleteRealLooking` was given. */
  realLooking: string[];
}

const HISTORY_DAYS = 14;
/** Scales every area's daily pattern (about 240 client shifts a day). */
const DEMAND = 1.28;
/** People per shift a day in each office and role (each works four or five shifts a week, some less). */
const SUPPLY = 1.9;
const AHEAD_DAYS = 3;
const MIN = 60_000;
const HOUR = 60 * MIN;
const PACKS = ['healthcare', 'labour-hire'];

type Row = Record<string, unknown>;
type Fate = 'booked' | 'accepted' | 'worker_to_confirm' | 'client_to_confirm' | 'released' | 'new' | 'pulled_out'
  | 'client_cancelled' | 'client_withdrew' | 'our_mistake' | 'not_filled'
  /** Past only: ended with nobody on it (offers went out, nobody took it), or pulled out and not refilled. */
  | 'unfilled';
type Phase = 'past' | 'started' | 'today' | 'd1' | 'd2' | 'd3';

/** Resets the business and seeds the demo day (or, without confirm RESET, reports what it would do). */
export async function demoDay(db: ClientBase, opts: DemoOptions): Promise<DemoResult> {
  const log = opts.log ?? (() => undefined);
  const refusal = tenantRefusal(opts.slug);
  if (refusal) throw new DemoRefusal(refusal);
  const now = opts.now ?? new Date();
  await db.query('begin');
  try {
    await db.query(`set local lock_timeout = '20s'`);
    await db.query(`select pg_advisory_xact_lock(hashtext('crop-demo-day'))`);
    const t = (await db.query<{ id: string }>('select id from tenants where slug = $1', [opts.slug])).rows[0];
    if (!t) throw new DemoRefusal(`No business with the short name "${opts.slug}"`);
    const tenantId = t.id;
    const zone = (await db.query<{ timezone: string }>('select timezone from tenant_settings where tenant_id = $1', [tenantId])).rows[0]?.timezone ?? 'Australia/Melbourne';
    const day = opts.day ?? localDateOf(now, zone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new DemoRefusal('Give the day as YYYY-MM-DD');
    if (Math.abs(daysBetween(localDateOf(now, zone), day)) > 7) throw new DemoRefusal('Choose a day within a week of today');

    const real = await realLookingData(db, tenantId);
    if (real.length && !opts.deleteRealLooking) {
      throw new DemoRefusal(`This business holds data that may be real, so nothing was changed:\n  ${real.join('\n  ')}\n`
        + 'If these are only test entries, run again with --delete-real-looking (workflow: delete_real_looking = yes) to delete them too.');
    }
    if (real.length) log(`${opts.confirm === 'RESET' ? 'Deleting' : 'Would delete'} records that may be real, as asked (--delete-real-looking):\n  ${real.join('\n  ')}`);
    const demoUsers = (await db.query<{ id: string }>(`select id from users where idp_subject like $1`, [`demo-day:${opts.slug}:%`])).rows.map(r => r.id);
    const plan = await planCleanup(db, tenantId, demoUsers);
    const removed = Object.fromEntries(Object.entries(plan.counts).filter(([, n]) => n > 0));
    if (opts.confirm !== 'RESET') {
      await db.query('rollback');
      log(`Dry run for ${opts.slug} (${day}): nothing changed. Type RESET to delete and reseed.`);
      for (const [k, n] of Object.entries(removed)) log(`  would delete ${n} ${k}`);
      return { dryRun: true, tenantId, day, removed, created: {}, realLooking: real };
    }

    const triggered = await triggerTables(db);
    for (const tb of triggered) await db.query(`alter table ${tb} disable trigger user`);
    await runCleanup(db, tenantId, demoUsers, plan);
    log(`Deleted ${Object.values(removed).reduce((a, b) => a + b, 0)} rows from ${Object.keys(removed).length} tables`);
    for (const [k, n] of Object.entries(removed)) log(`  deleted ${n} ${k}`);

    const created = await seed(db, tenantId, opts.slug, day, now, zone);
    for (const tb of triggered) await db.query(`alter table ${tb} enable trigger user`);
    await db.query('commit');
    for (const [k, n] of Object.entries(created)) log(`  created ${n} ${k}`);
    // Shifts per day by status (ended open = unfilled), for the run's log.
    const days = await db.query<{ d: string; n: number; open: number; assigned: number; booked: number; cancelled: number; unfilled: number }>(
      `select to_char((s.starts_at at time zone f.timezone)::date, 'YYYY-MM-DD') as d, count(*)::int as n,
              count(*) filter (where s.status = 'open' and s.ends_at > $2)::int as open, count(*) filter (where s.status = 'assigned')::int as assigned,
              count(*) filter (where s.status = 'booked')::int as booked, count(*) filter (where s.status = 'cancelled')::int as cancelled,
              count(*) filter (where s.status = 'open' and s.ends_at <= $2)::int as unfilled
         from shifts s join facilities f on f.id = s.facility_id where s.tenant_id = $1 group by 1 order by 1`, [tenantId, now]);
    log('Shifts by day: total (open still to fill / allocated / booked / cancelled / ended unfilled)');
    for (const r of days.rows) log(`  ${r.d}${r.d === day ? ' (today)' : ''}: ${r.n} (${r.open} / ${r.assigned} / ${r.booked} / ${r.cancelled} / ${r.unfilled})`);
    return { dryRun: false, tenantId, day, removed, created, realLooking: real };
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw err;
  }
}

/** Inserts rows (all with the same keys) in chunks through json_populate_recordset, so defaults apply to other columns. */
async function insertRows(db: ClientBase, table: string, rows: Row[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const list = cols.map(c => `"${c}"`).join(', ');
  for (let i = 0; i < rows.length; i += 1000) {
    await db.query(`insert into ${table} (${list}) select ${list} from json_populate_recordset(null::${table}, $1::json)`, [JSON.stringify(rows.slice(i, i + 1000))]);
  }
}

// ---------------------------------------------------------------------------------------------------------------

interface Officer { id: string; name: string; office: string | null }
interface Rule { typeId: string; severity: 'hard' | 'warning' | 'optional' }
interface Cred { typeId: string; expiry: string | null; verified: boolean }
interface Worker {
  id: string; first: string; last: string; name: string; email: string; gender: 'F' | 'M'; roles: string[]; office: string; flex: boolean;
  employment: 'casual' | 'bank' | 'part_time'; startsOn: string; cap: number; visaWeekly: boolean;
  pattern: Map<number, string[]> | null; notAvailable: Map<string, string[]>; leave: Set<string>;
  creds: Map<string, Cred>; rtwOk: (date: string) => boolean;
  busy: { s: number; e: number }[]; weeks: Map<string, number>; sites: Map<string, number>;
}
interface Site { id: string; def: SiteDef; client: ClientDef; clientId: string; office: string; zone: string; areas: { id: string; name: string; kind: AreaKind }[]; contacts: { id: string; name: string; email: string }[] }
interface Shift {
  id: string; site: Site; areaId: string; areaName: string; kind: AreaKind; role: string; date: string; start: string; end: string; brk: number;
  startsAt: Date; endsAt: Date; period: string; notes: string | null; gender: 'F' | 'M' | null; duty: string | null;
  phase: Phase; fate: Fate; worker: Worker | null; pulled: Worker | null; hadPerson: Worker | null; usual: Worker | null; codeId: string | null;
  t0?: Date; orderId?: string; relative?: boolean;
}

async function seed(db: ClientBase, tenantId: string, slug: string, day: string, now: Date, zone: string): Promise<Record<string, number>> {
  const rnd = seededRandom(`crop-demo-day:${slug}:${day}`);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const chance = (p: number) => rnd() < p;
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const nowMs = now.getTime();
  /** A time between a and b (ms), never later than a moment ago. */
  const at = (a: number, b: number) => new Date(Math.min(between(a, Math.max(b, a + MIN)), nowMs - 20_000));
  const counts: Record<string, number> = {};
  const put = async (table: string, rows: Row[]) => { await insertRows(db, table, rows); if (rows.length) counts[table] = (counts[table] ?? 0) + rows.length; };

  // Settings stay as they are; a business without any gets Australia (Melbourne).
  await db.query(`insert into tenant_settings(tenant_id) values ($1) on conflict (tenant_id) do nothing`, [tenantId]);

  // ---- The invented allocation officers (sign-ins nobody can use) -----------------------------------------------
  const officers: Officer[] = [];
  for (const o of OFFICERS) {
    const name = `${o.first} ${o.last}`;
    const u = (await db.query<{ id: string }>(
      `insert into users(idp_subject, email, display_name, email_verified) values ($1, $2, $3, false)
       on conflict (idp_subject) do update set email = excluded.email, display_name = excluded.display_name returning id`,
      [OFFICER_SUBJECT(slug, o.key), officerEmail(o), name])).rows[0];
    officers.push({ id: u.id, name, office: o.office });
  }
  await put('memberships', officers.map(o => ({ tenant_id: tenantId, user_id: o.id, role: 'allocator', created_at: new Date(nowMs - 200 * 86_400_000) })));
  await put('member_focus', officers.map(o => ({ tenant_id: tenantId, user_id: o.id, focus: 'allocator', sees_costs: false })));
  const lead = officers[0];

  // ---- Industry templates: healthcare and labour hire, if not applied yet ----------------------------------------
  const applied = new Set((await db.query<{ pack_id: string }>('select pack_id from industry_pack_applications where tenant_id = $1', [tenantId])).rows.map(r => r.pack_id));
  for (const id of PACKS) if (!applied.has(id)) await applyPack(db as never, tenantId, lead.id, packById(id)!);

  const typeRows = (await db.query<{ id: string; name: string; has_number: boolean; has_expiry: boolean; catalogue_code: string | null; category: string }>(
    'select id, name, has_number, has_expiry, catalogue_code, category::text from credential_types where tenant_id = $1 and active', [tenantId])).rows;
  const typeById = new Map(typeRows.map(r => [r.id, r]));
  const typeByName = new Map(typeRows.map(r => [r.name, r]));
  const ruleRows = (await db.query<{ credential_type_id: string; scope: string; role: string | null; severity: Rule['severity'] }>(
    'select credential_type_id, scope, role, severity::text as severity from credential_requirements where tenant_id = $1', [tenantId])).rows;
  const rulesFor = (role: string): Rule[] => ruleRows.filter(r => r.scope === 'all_workers' || r.role === role).map(r => ({ typeId: r.credential_type_id, severity: r.severity }))
    .filter(r => typeById.has(r.typeId));
  const duties = new Map((await db.query<{ id: string; name: string }>('select id, name from shift_duties where tenant_id = $1 and active', [tenantId])).rows.map(r => [r.name, r.id]));
  const dutyRules = new Map<string, string[]>();
  for (const r of (await db.query<{ duty_id: string; credential_type_id: string }>(
    `select duty_id, credential_type_id from shift_duty_requirements where tenant_id = $1 and severity = 'hard'`, [tenantId])).rows) {
    dutyRules.set(r.duty_id, [...(dutyRules.get(r.duty_id) ?? []), r.credential_type_id]);
  }
  const codes = (await db.query<{ id: string; start: string; end: string }>(
    `select id, to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as end from shift_codes where tenant_id = $1 and facility_id is null and active`, [tenantId])).rows;
  const codeFor = (start: string, end: string) => codes.find(c => c.start === start && c.end === end)?.id ?? null;
  const roleNames = new Set((await db.query<{ name: string }>('select name from business_roles where tenant_id = $1', [tenantId])).rows.map(r => r.name));

  // ---- Offices, clients, contacts, sites, areas --------------------------------------------------------------------
  const officeIds = new Map(OFFICES.map(o => [o.key, randomUUID()]));
  await put('offices', OFFICES.map(o => ({ id: officeIds.get(o.key), tenant_id: tenantId, name: o.name, state: o.state })));
  await put('member_offices', officers.filter(o => o.office).map(o => ({ tenant_id: tenantId, user_id: o.id, office_id: officeIds.get(o.office!), set_by: lead.id })));
  const clientRows: Row[] = [];
  const contactRows: Row[] = [];
  const facilityRows: Row[] = [];
  const areaRows: Row[] = [];
  const sites: Site[] = [];
  for (const c of CLIENTS) {
    const clientId = randomUUID();
    clientRows.push({ id: clientId, tenant_id: tenantId, name: c.name, status: 'active', billing_contact_name: 'Accounts payable',
      billing_email: `accounts.${c.key}@example.com`, notes: `${c.kind}. ${c.notes}`, confirms_bookings: c.confirms, rank: c.rank });
    const contacts = c.contacts.map(p => ({ id: randomUUID(), name: p.name, email: `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com` }));
    contacts.forEach((p, i) => contactRows.push({ id: p.id, tenant_id: tenantId, client_id: clientId, name: p.name, position: c.contacts[i].position, email: p.email }));
    for (const s of c.sites) {
      const office = OFFICES.find(o => o.key === s.office)!;
      const siteZone = office.state === 'QLD' ? 'Australia/Brisbane' : 'Australia/Melbourne';
      const site: Site = { id: randomUUID(), def: s, client: c, clientId, office: s.office, zone: siteZone, areas: [], contacts };
      facilityRows.push({ id: site.id, tenant_id: tenantId, name: s.name, timezone: siteZone, client_id: clientId, address_line: s.address, suburb: s.suburb,
        state: office.state, postcode: s.postcode, parking_notes: s.parking ?? null, entry_notes: s.entry ?? null, country: 'AU', office_id: officeIds.get(s.office) });
      for (const [name, kind] of s.areas) {
        const a = { id: randomUUID(), name, kind };
        site.areas.push(a);
        areaRows.push({ id: a.id, tenant_id: tenantId, facility_id: site.id, name });
      }
      sites.push(site);
    }
  }
  await put('clients', clientRows);
  await put('client_contacts', contactRows);
  await put('facilities', facilityRows);
  await put('areas', areaRows);

  // ---- People --------------------------------------------------------------------------------------------------------
  const officerOf = (office: string | null) => {
    const mine = officers.filter(o => o.office === office);
    return mine.length && !chance(0.12) ? pick(mine) : pick(officers);
  };
  const usedNames = new Set<string>([...officers.map(o => o.name)]);
  const newName = (male: boolean) => {
    for (;;) {
      const first = pick(male ? FIRST_M : FIRST_F);
      const last = pick(SURNAMES);
      if (!usedNames.has(`${first} ${last}`)) { usedNames.add(`${first} ${last}`); return { first, last }; }
    }
  };
  const emailOf = (first: string, last: string, n: number) => `${first}.${last}${n}@example.com`.toLowerCase().replace(/[^a-z0-9.@]/g, '');
  // How many shifts a day each office asks for, by role (an average day of the week).
  const demand = new Map<string, number>();
  for (const site of sites) for (const area of site.areas) for (const slot of SLOTS[area.kind]) {
    const key = `${site.office}|${slot.role}`;
    demand.set(key, (demand.get(key) ?? 0) + slot.n * DEMAND * (5 + 2 * WEEKEND[area.kind]) / 7);
  }
  const workers: Worker[] = [];
  const workerRows: Row[] = [];
  const termRows: Row[] = [];
  const addressRows: Row[] = [];
  const officeStateOf = (k: string) => OFFICES.find(o => o.key === k)?.state ?? 'VIC';
  const credRows: Row[] = [];
  const credEventRows: Row[] = [];
  const rtwRows: Row[] = [];
  const rtwEventRows: Row[] = [];
  const patternRows: Row[] = [];
  const dateRows: Row[] = [];
  let serial = 1;
  const PATTERNS: string[][][] = [
    [['am', 'pm', 'night']], [['am', 'pm']], [['am', 'pm']], [['am']], [['pm', 'night']], [['night']], [['am', 'pm', 'night'], ['am']],
  ];
  const people: { g: (typeof ROLE_GROUPS)[number]; office: string }[] = [];
  for (const g of ROLE_GROUPS) {
    if (!roleNames.has(g.role)) continue;
    for (const o of OFFICES) {
      const d = [g.role, ...(g.covers ?? [])].reduce((sum, r) => sum + (demand.get(`${o.key}|${r}`) ?? 0), 0);
      for (let i = 0; i < Math.round(d * SUPPLY); i++) people.push({ g, office: o.key });
    }
  }
  for (const { g, office } of people) {
    {
      const male = chance(g.male);
      const { first, last } = newName(male);
      const roles = [g.role, ...(g.also ?? []).filter(([r, p]) => roleNames.has(r) && chance(p)).map(([r]) => r)];
      const employment = chance(0.68) ? 'casual' : chance(0.65) ? 'bank' : 'part_time';
      const tenureDays = chance(0.03) ? Math.floor(between(2, 8)) : Math.floor(between(40, 1500));
      const startsOn = addDays(day, -tenureDays);
      const w: Worker = {
        id: randomUUID(), first, last, name: `${first} ${last}`, email: emailOf(first, last, serial++), gender: male ? 'M' : 'F', roles, office,
        flex: office !== 'sun' && chance(0.15), employment, startsOn, cap: employment === 'part_time' ? 4 : Math.floor(between(4, 6.99)), visaWeekly: false,
        pattern: null, notAvailable: new Map(), leave: new Set(), creds: new Map(), rtwOk: () => true, busy: [], weeks: new Map(), sites: new Map(),
      };
      workers.push(w);
      const created = new Date(localToUtc(startsOn, '10:00', zone).getTime() - 3 * 86_400_000);
      workerRows.push({ id: w.id, tenant_id: tenantId, first_name: first, last_name: last, preferred_name: null, email: w.email, status: 'active',
        roles, notes: chance(0.18) ? pick(WORKER_NOTES) : null, created_at: created, updated_at: created, gender: w.gender, recruitment_stage: null, stage_changed_at: null });
      // An invented home near their office (a real suburb and postcode, a made-up street), so distances show.
      if (chance(0.94)) {
        const [suburb, postcode] = pick(HOME_PLACES[office] ?? HOME_PLACES.mel!);
        addressRows.push({ id: randomUUID(), tenant_id: tenantId, worker_id: w.id, label: 'Home', line1: `${Math.floor(between(1, 199))} ${pick(HOME_STREETS)}`,
          line2: null, suburb, region: officeStateOf(office), postcode, country: 'AU', is_current: true, created_at: created });
      }
      termRows.push({ id: randomUUID(), tenant_id: tenantId, worker_id: w.id, employment_type: employment,
        contracted_hours: employment === 'part_time' ? pick([24, 30, 32]) : null, starts_on: startsOn, created_by: lead.id, created_at: created });

      // Usual week: most people say when they can work; a few say nothing.
      if (chance(0.72)) {
        w.pattern = new Map();
        const shape = pick(PATTERNS);
        const daysOff = new Set([Math.ceil(between(0.01, 7)), chance(0.5) ? Math.ceil(between(0.01, 7)) : 0]);
        for (let wd = 1; wd <= 7; wd++) {
          const periods = daysOff.has(wd) ? [] : pick(shape);
          w.pattern.set(wd, periods);
          patternRows.push({ id: randomUUID(), tenant_id: tenantId, worker_id: w.id, weekday: wd, periods, updated_by: null, updated_at: created });
        }
      }

      // Credentials: every must-have and most should-haves of their roles, plus duty credentials for some.
      const wanted = new Map<string, 'hard' | 'warning' | 'optional'>();
      for (const r of roles) for (const rule of rulesFor(r)) if (rule.severity !== 'optional' && (rule.severity === 'hard' || chance(0.85))) wanted.set(rule.typeId, rule.severity === 'hard' || wanted.get(rule.typeId) === 'hard' ? 'hard' : 'warning');
      const extra = [roles.some(r => r === 'Enrolled Nurse' || r === 'Personal Care Worker') && chance(0.6) ? 'Medication Administration Competency' : null,
        roles.includes('Disability Support Worker') && chance(0.85) ? 'Driver Licence (C, car)' : null];
      for (const n of extra) { const ty = n ? typeByName.get(n) : undefined; if (ty && !wanted.has(ty.id)) wanted.set(ty.id, 'warning'); }
      for (const [typeId] of wanted) {
        const ty = typeById.get(typeId)!;
        const yearly = ty.category === 'vaccination' || /CPR|Registration/.test(ty.name);
        const expiry = !ty.has_expiry ? null : chance(0.07) ? addDays(day, Math.floor(between(3, 29))) : addDays(day, Math.floor(between(35, yearly ? 360 : 1000)));
        const issue = addDays(expiry ?? day, -Math.floor(between(yearly ? 300 : 400, yearly ? 365 : 1100)));
        const issueDate = issue > day ? addDays(day, -30) : issue;
        const added = new Date(Math.max(created.getTime(), localToUtc(issueDate, '12:00', zone).getTime()));
        const verifiedAt = new Date(Math.min(added.getTime() + between(1, 72) * HOUR, nowMs - HOUR));
        const id = randomUUID();
        w.creds.set(typeId, { typeId, expiry, verified: true });
        credRows.push({ id, tenant_id: tenantId, worker_id: w.id, credential_type_id: typeId,
          number: ty.has_number ? `DEMO-${(ty.catalogue_code ?? 'x').split('.').pop()!.replace(/[^a-z0-9]/g, '').slice(0, 6).toUpperCase()}-${Math.floor(between(10000, 99999))}` : null,
          issue_date: issueDate, expiry_date: expiry, evidence: 'uploaded', verification: 'verified', verified_by: lead.id, verified_at: verifiedAt,
          rejection_reason: null, created_at: added, updated_at: verifiedAt });
        credEventRows.push({ id: randomUUID(), tenant_id: tenantId, worker_credential_id: id, at: added, actor_user_id: lead.id, action: 'created', details: {} });
        credEventRows.push({ id: randomUUID(), tenant_id: tenantId, worker_credential_id: id, at: verifiedAt, actor_user_id: lead.id, action: 'verified', details: {} });
      }

      // Right to work.
      const roll = rnd();
      const status = roll < 0.74 ? 'citizen' : roll < 0.86 ? 'permanent_resident' : roll < 0.89 ? 'nz_citizen' : 'visa_holder';
      const visa = status !== 'visa_holder' ? null : chance(0.5) ? { sub: '500', limited: true } : chance(0.6) ? { sub: '485', limited: false } : { sub: '482', limited: false };
      const visaExpiry = visa ? addDays(day, chance(0.08) ? Math.floor(between(10, 25)) : Math.floor(between(90, 900))) : null;
      if (visa?.limited) { w.visaWeekly = true; w.cap = Math.min(w.cap, 2); }
      w.rtwOk = date => !visaExpiry || visaExpiry >= date;
      const rtwId = randomUUID();
      rtwRows.push({ id: rtwId, tenant_id: tenantId, worker_id: w.id, status, citizen_proof_type: status === 'citizen' ? pick(['au_passport', 'birth_certificate', 'citizenship_certificate']) : null,
        visa_type: visa ? (visa.sub === '500' ? 'Student' : visa.sub === '485' ? 'Temporary Graduate' : 'Skills in Demand') : null, visa_subclass: visa?.sub ?? null,
        visa_expiry: visaExpiry, work_limit: visa ? (visa.limited ? 'limited' : 'unlimited') : null, work_hours_per_fortnight: visa?.limited ? 48 : null,
        vevo_checked_on: status === 'citizen' ? null : addDays(startsOn, -2), vevo_result: status === 'citizen' ? null : 'confirmed',
        verification: 'verified', verified_by: lead.id, verified_at: created, rejection_reason: null, created_by: lead.id, created_at: created });
      rtwEventRows.push({ id: randomUUID(), tenant_id: tenantId, record_id: rtwId, at: created, actor_user_id: lead.id, action: 'recorded', details: {} });
      rtwEventRows.push({ id: randomUUID(), tenant_id: tenantId, record_id: rtwId, at: new Date(created.getTime() + HOUR), actor_user_id: lead.id, action: 'verified', details: {} });
    }
  }

  // A few people whose records need the office: an expired must-have, one waiting to be checked, one sent back.
  const mustOf = (w: Worker) => w.roles.flatMap(r => rulesFor(r).filter(x => x.severity === 'hard').map(x => x.typeId));
  const problems = [...workers].sort(() => rnd() - 0.5).slice(0, 9);
  problems.forEach((w, i) => {
    const typeId = pick(mustOf(w).filter(id => typeById.get(id)!.has_expiry));
    if (!typeId) return;
    const row = credRows.find(r => r.worker_id === w.id && r.credential_type_id === typeId)!;
    const cred = w.creds.get(typeId)!;
    if (i < 4) {
      row.expiry_date = cred.expiry = addDays(day, -Math.floor(between(2, 20)));
      row.issue_date = addDays(cred.expiry, -365);
    } else {
      cred.verified = false;
      row.verification = i === 8 ? 'rejected' : 'unverified';
      row.rejection_reason = i === 8 ? 'Photo unreadable; please send it again' : null;
      row.verified_by = null; row.verified_at = null;
      row.created_at = row.updated_at = new Date(nowMs - between(4, 60) * HOUR);
      for (let k = credEventRows.length - 1; k >= 0; k--) if (credEventRows[k].worker_credential_id === row.id) credEventRows.splice(k, 1);
      credEventRows.push({ id: randomUUID(), tenant_id: tenantId, worker_credential_id: row.id, at: row.created_at, actor_user_id: null, action: 'created', details: { via: 'app' } });
    }
  });

  // Leave: approved (which the fill respects) and asked for; dates someone can't work.
  const leaveRows: Row[] = [];
  for (let i = 0; i < 22; i++) {
    const w = pick(workers);
    const from = addDays(day, Math.floor(between(-12, 6)));
    const len = Math.floor(between(1, 7));
    const status = i < 14 ? 'approved' : i < 19 ? 'requested' : 'declined';
    const asked = new Date(localToUtc(addDays(from, -Math.floor(between(5, 25))), '11:00', zone).getTime());
    const askedAt = new Date(Math.min(asked.getTime(), nowMs - 2 * HOUR));
    leaveRows.push({ id: randomUUID(), tenant_id: tenantId, worker_id: w.id, kind: pick(['annual', 'annual', 'personal', 'unpaid', 'other']), starts_on: from,
      ends_on: addDays(from, len - 1), status, note: null, created_by: null, created_at: askedAt,
      decided_by: status === 'requested' ? null : lead.id, decided_at: status === 'requested' ? null : new Date(askedAt.getTime() + 20 * HOUR > nowMs ? nowMs - HOUR : askedAt.getTime() + 20 * HOUR) });
    if (status === 'approved') for (let d = 0; d < len; d++) w.leave.add(addDays(from, d));
  }
  for (let i = 0; i < 24; i++) {
    const w = pick(workers);
    const on = addDays(day, Math.floor(between(0, AHEAD_DAYS + 1)));
    if (w.notAvailable.has(on)) continue;
    const periods = chance(0.6) ? [] : chance(0.5) ? ['am'] : ['pm'];
    w.notAvailable.set(on, periods);
    dateRows.push({ id: randomUUID(), tenant_id: tenantId, worker_id: w.id, on_date: on, periods, note: periods.length ? 'Only part of the day' : 'Not available', updated_by: null, updated_at: new Date(nowMs - between(5, 90) * HOUR) });
  }

  await put('workers', workerRows);
  await put('employment_terms', termRows);
  await put('worker_addresses', addressRows);
  await put('worker_credentials', credRows);
  await put('credential_events', credEventRows);
  await put('right_to_work_records', rtwRows);
  await put('right_to_work_events', rtwEventRows);
  await put('availability_patterns', patternRows);
  await put('availability_dates', dateRows);
  await put('leave_records', leaveRows);

  // Applicants on the recruitment board.
  const applicantRows: Row[] = [];
  const recruitRows: Row[] = [];
  const STAGES = ['applied', 'applied', 'applied', 'screening', 'screening', 'interview', 'interview', 'offer', 'applied', 'screening'];
  STAGES.forEach((stage, i) => {
    const male = chance(0.25);
    const { first, last } = newName(male);
    const id = randomUUID();
    const role = [ROLE_GROUPS[0].role, ROLE_GROUPS[2].role, ROLE_GROUPS[3].role, ROLE_GROUPS[4].role][i % 4];
    const appliedAt = new Date(nowMs - between(1, 20) * 86_400_000);
    const order = ['applied', 'screening', 'interview', 'offer'];
    let t = appliedAt.getTime();
    let from: string | null = null;
    for (const s of order.slice(0, order.indexOf(stage) + 1)) {
      recruitRows.push({ id: randomUUID(), tenant_id: tenantId, worker_id: id, at: new Date(t), actor_user_id: lead.id, actor_name: lead.name, to_stage: s, from_stage: from, note: null });
      from = s;
      t = Math.min(t + between(10, 70) * HOUR, nowMs - HOUR);
    }
    applicantRows.push({ id, tenant_id: tenantId, first_name: first, last_name: last, preferred_name: null, email: emailOf(first, last, serial++), status: 'applicant',
      roles: roleNames.has(role) ? [role] : [], notes: null, created_at: appliedAt, updated_at: appliedAt, gender: male ? 'M' : 'F', recruitment_stage: stage, stage_changed_at: new Date(t) });
  });
  await put('workers', applicantRows);
  await put('recruitment_events', recruitRows);

  // ---- Shifts: what each client asks for, day by day ---------------------------------------------------------------
  const firstDay = addDays(day, -HISTORY_DAYS);
  const shifts: Shift[] = [];
  const phaseOf = (s: { startsAt: Date; endsAt: Date; date: string }): Phase => {
    if (s.endsAt.getTime() <= nowMs) return 'past';
    if (s.startsAt.getTime() <= nowMs) return 'started';
    const d = daysBetween(day, s.date);
    return d <= 0 ? 'today' : d === 1 ? 'd1' : d === 2 ? 'd2' : 'd3';
  };
  const make = (site: Site, area: Site['areas'][number], slot: { role: string; start: string; end: string; brk: number; note?: string; duty?: string; gender?: boolean }, date: string): Shift | null => {
    if (!roleNames.has(slot.role)) return null;
    const startsAt = localToUtc(date, slot.start, site.zone);
    const endDate = slot.end <= slot.start ? addDays(date, 1) : date;
    const endsAt = localToUtc(endDate, slot.end, site.zone);
    const gender = slot.gender && chance(0.12) ? (chance(0.8) ? 'F' : 'M') : null;
    const duty = slot.duty && duties.has(slot.duty) && chance(0.3) ? slot.duty : null;
    const s: Shift = {
      id: randomUUID(), site, areaId: area.id, areaName: area.name, kind: area.kind, role: slot.role, date, start: slot.start, end: slot.end, brk: slot.brk,
      startsAt, endsAt, period: periodOf(slot.start), notes: slot.note && chance(0.7) ? slot.note : null, gender, duty,
      phase: 'past', fate: 'booked', worker: null, pulled: null, hadPerson: null, usual: null, codeId: codeFor(slot.start, slot.end),
    };
    s.phase = phaseOf(s);
    return s;
  };
  for (let d = firstDay; d <= addDays(day, AHEAD_DAYS); d = addDays(d, 1)) {
    const weekend = weekdayOf(d) >= 6;
    const ahead = daysBetween(day, d);
    // Orders for the coming days are still arriving: fewer the further out.
    const arrived = ahead <= 1 ? 1 : ahead === 2 ? 0.93 : 0.8;
    for (const site of sites) for (const area of site.areas) {
      const factor = (weekend ? WEEKEND[area.kind] : 1) * arrived;
      for (const slot of SLOTS[area.kind]) {
        const want = slot.n * factor * DEMAND;
        const n = Math.floor(want) + (rnd() < want - Math.floor(want) ? 1 : 0);
        for (let k = 0; k < n; k++) { const s = make(site, area, slot, d); if (s) shifts.push(s); }
      }
    }
  }
  // Around now (when the day is today): a few that started with nobody there and several starting within two hours.
  const relative: Shift[] = [];
  if (day === localDateOf(now, zone)) {
    const plan: [number, Fate][] = [[-35, 'new'], [-20, 'pulled_out'], [-10, 'released'], [25, 'new'], [40, 'released'], [50, 'pulled_out'],
      [60, 'released'], [75, 'new'], [85, 'accepted'], [95, 'booked'], [105, 'client_to_confirm'], [115, 'released']];
    const busySites = sites.filter(s => s.areas.some(a => a.kind === 'aged' || a.kind === 'ward' || a.kind === 'sil'));
    for (const [mins, fate] of plan) {
      const site = pick(busySites);
      const area = pick(site.areas.filter(a => SLOTS[a.kind].length));
      const slot = pick(SLOTS[area.kind]);
      const start = new Date(Math.round((nowMs + mins * MIN) / (15 * MIN)) * 15 * MIN);
      const len = slot.brk ? 8 * HOUR + slot.brk * MIN : 4 * HOUR;
      const st = localTimeOf(start, site.zone);
      const en = localTimeOf(new Date(start.getTime() + len), site.zone);
      const s = make(site, area, { ...slot, start: st, end: en }, localDateOf(start, site.zone));
      if (!s) continue;
      s.fate = fate;
      s.relative = true;
      s.notes = s.notes ?? (mins < 0 ? 'Urgent: the client rang, nobody has arrived.' : null);
      relative.push(s);
    }
  }

  // What happens to each shift.
  const FATES: Record<Phase, [Fate, number][]> = {
    past: [['client_cancelled', 0.05], ['client_withdrew', 0.03], ['our_mistake', 0.005], ['unfilled', 0.025], ['booked', 1]],
    started: [['booked', 1]],
    today: [['client_cancelled', 0.03], ['client_withdrew', 0.015], ['new', 0.07], ['released', 0.13], ['pulled_out', 0.025], ['accepted', 0.05],
      ['worker_to_confirm', 0.03], ['client_to_confirm', 0.05], ['booked', 1]],
    d1: [['client_cancelled', 0.03], ['client_withdrew', 0.02], ['new', 0.17], ['released', 0.25], ['pulled_out', 0.02], ['accepted', 0.08],
      ['worker_to_confirm', 0.03], ['client_to_confirm', 0.05], ['booked', 1]],
    d2: [['client_cancelled', 0.02], ['client_withdrew', 0.02], ['new', 0.3], ['released', 0.3], ['pulled_out', 0.01], ['accepted', 0.06],
      ['worker_to_confirm', 0.02], ['client_to_confirm', 0.03], ['booked', 1]],
    d3: [['client_cancelled', 0.015], ['client_withdrew', 0.015], ['new', 0.48], ['released', 0.28], ['accepted', 0.04], ['client_to_confirm', 0.02], ['booked', 1]],
  };
  for (const s of shifts) {
    let x = rnd();
    for (const [f, p] of FATES[s.phase]) { if (x < p) { s.fate = f; break; } x -= p; }
    if (s.phase === 'past' && s.fate === 'booked' && chance(0.035)) s.fate = 'pulled_out';
  }
  const all = [...shifts, ...relative].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const s of all) {
    if (!s.site.client.confirms && (s.fate === 'worker_to_confirm' || s.fate === 'client_to_confirm')) s.fate = s.fate === 'worker_to_confirm' ? 'accepted' : 'booked';
  }

  // ---- Who works what: a greedy fill in start order that keeps to the rules CROP checks ----------------------------
  const REST = 10 * HOUR;
  const credsOk = (w: Worker, s: Shift) => {
    const needs = [...new Set(w.roles.includes(s.role) ? rulesFor(s.role).filter(r => r.severity === 'hard').map(r => r.typeId) : [])];
    if (s.duty) needs.push(...(dutyRules.get(duties.get(s.duty)!) ?? []));
    return needs.every(id => { const c = w.creds.get(id); return c && c.verified && (!c.expiry || c.expiry >= s.date); });
  };
  const freeFor = (w: Worker, s: Shift) => {
    const a = s.startsAt.getTime(), b = s.endsAt.getTime();
    return w.busy.every(x => !(a < x.e + REST && x.s < b + REST));
  };
  const officeState = (k: string) => OFFICES.find(o => o.key === k)!.state;
  const canWork = (w: Worker, s: Shift, opts: { busy?: boolean } = {}) => {
    if (!w.roles.includes(s.role)) return false;
    if (w.office !== s.site.office && !(w.flex && officeState(w.office) === officeState(s.site.office))) return false;
    if (w.startsOn > s.date || w.leave.has(s.date) || !w.rtwOk(s.date)) return false;
    const na = w.notAvailable.get(s.date);
    if (na && !na.includes(s.period)) return false;
    const p = w.pattern?.get(weekdayOf(s.date));
    if (!na && p && !p.includes(s.period)) return false;
    if (!credsOk(w, s)) return false;
    if (opts.busy !== false) {
      if (!freeFor(w, s)) return false;
      if (recent(w, s) >= w.cap) return false;
    }
    return true;
  };
  /** Shifts the person already has in the 7 days ending on this one's day (a rolling week, so weekends aren't starved). */
  const recent = (w: Worker, s: Shift) => {
    const from = s.startsAt.getTime() - 6.5 * 86_400_000, to = s.startsAt.getTime() + 6.5 * 86_400_000;
    let before = 0, after = 0;
    for (const x of w.busy) { if (x.s > from && x.s <= s.startsAt.getTime()) before++; if (x.s >= s.startsAt.getTime() && x.s < to) after++; }
    return Math.max(before, after);
  };
  const book = (w: Worker, s: Shift) => {
    w.busy.push({ s: s.startsAt.getTime(), e: s.endsAt.getTime() });
    const wk = mondayOf(s.date);
    w.weeks.set(wk, (w.weeks.get(wk) ?? 0) + 1);
    w.sites.set(s.site.id, (w.sites.get(s.site.id) ?? 0) + 1);
  };
  const slotKey = (s: Shift) => `${s.areaId}|${s.role}|${s.start}`;
  const slotCounts = new Map<string, Map<Worker, number>>();
  const choose = (s: Shift, except: Worker | null = null): Worker | null => {
    let best: Worker | null = null;
    let bestScore = -Infinity;
    for (const w of workers) {
      if (w === except || !canWork(w, s)) continue;
      const here = w.sites.get(s.site.id) ?? 0;
      const score = Math.min(here, 4) * 2.5 + rnd() * 3 - recent(w, s) * 0.8 + (s.usual === w ? 9 : 0);
      if (score > bestScore) { best = w; bestScore = score; }
    }
    return best;
  };
  const NEEDS_PERSON: Fate[] = ['booked', 'accepted', 'worker_to_confirm', 'client_to_confirm'];
  for (const s of all) {
    // The usual person: whoever has worked this slot most in the last two weeks (aged care, houses, wards).
    if (s.phase !== 'past' && ['aged', 'memory', 'sil', 'ward', 'rehab'].includes(s.kind) && chance(0.75)) {
      const m = slotCounts.get(slotKey(s));
      const top = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0] : undefined;
      if (top && top[1] >= 3) s.usual = top[0];
    }
    if (s.fate === 'pulled_out') {
      // Someone who was on it and pulled out (they stay free for other work).
      const p = workers.find(w => canWork(w, s) && rnd() < 0.15) ?? null;
      s.pulled = p;
      if (s.phase === 'past') {
        // About a third were never refilled: the shift ended with nobody (Unfilled on the queue's outcome tabs).
        const w = chance(0.3) ? null : choose(s, p);
        if (w) { s.worker = w; book(w, s); } else s.fate = 'unfilled';
      }
    } else if (NEEDS_PERSON.includes(s.fate)) {
      const w = choose(s);
      if (w) { s.worker = w; book(w, s); }
      else s.fate = s.phase === 'past' || (s.phase === 'started' && !s.relative) ? 'not_filled' : chance(0.6) ? 'released' : 'new';
    } else if ((s.fate === 'client_cancelled' || s.fate === 'client_withdrew') && chance(0.4)) {
      s.hadPerson = workers.find(w => canWork(w, s) && rnd() < 0.2) ?? null;
    }
    if (s.worker) {
      const m = slotCounts.get(slotKey(s)) ?? new Map<Worker, number>();
      m.set(s.worker, (m.get(s.worker) ?? 0) + 1);
      slotCounts.set(slotKey(s), m);
    }
  }
  // Two booked shifts in the next days whose person's police check runs out the day before: Needs attention shows them.
  const policeId = typeByName.get('National Police Check')?.id;
  if (policeId) {
    const soon = all.filter(s => (s.phase === 'd1' || s.phase === 'd2') && s.fate === 'booked' && s.worker?.creds.get(policeId)?.verified);
    for (const s of soon.sort(() => rnd() - 0.5).slice(0, 2)) {
      const c = s.worker!.creds.get(policeId)!;
      c.expiry = addDays(s.date, -1);
      const row = credRows.find(r => r.worker_id === s.worker!.id && r.credential_type_id === policeId);
      if (row) await db.query('update worker_credentials set expiry_date = $2, issue_date = least(issue_date, $2::date) where id = $1', [row.id, c.expiry]);
    }
  }

  // ---- Orders: shifts arrive in orders of one to three from the same site and day ---------------------------------
  const orderRows: Row[] = [];
  const bySite = [...all].sort((a, b) => a.site.id.localeCompare(b.site.id) || a.date.localeCompare(b.date) || a.startsAt.getTime() - b.startsAt.getTime());
  const firstMoment = localToUtc(addDays(firstDay, -3), '08:00', zone).getTime();
  const arrival = (s: Shift): number => {
    const start = s.startsAt.getTime();
    if (s.relative) return Math.min(start - 20 * MIN, nowMs - between(20, 180) * MIN);
    if (s.phase === 'past' || s.phase === 'started') return Math.max(firstMoment, start - between(10, 96) * HOUR);
    if (s.fate === 'new') return chance(0.7) ? nowMs - between(3, 180) * MIN : nowMs - between(3, 26) * HOUR;
    if (s.fate === 'released') return nowMs - between(40, 20 * 60) * MIN;
    return Math.max(firstMoment, Math.min(start - 6 * HOUR, nowMs - between(2, 60) * HOUR));
  };
  const CHANNELS = ['email', 'email', 'email', 'email', 'email', 'phone', 'phone', 'phone', 'portal', 'portal', 'other'];
  for (let i = 0; i < bySite.length;) {
    const size = 1 + Math.floor(rnd() * rnd() * 3.5);
    const group = [bySite[i]];
    for (let j = i + 1; j < bySite.length && group.length < size; j++) {
      const b = bySite[j];
      if (b.site !== group[0].site || b.date !== group[0].date || (b.fate === 'new') !== (group[0].fate === 'new') || b.relative || group[0].relative) break;
      group.push(b);
    }
    i += group.length;
    const s0 = group[0];
    const t0 = new Date(Math.min(...group.map(arrival)));
    const id = randomUUID();
    const c = s0.site.client;
    const contact = chance(0.8) ? pick(s0.site.contacts) : null;
    const channel = pick(CHANNELS);
    const officer = officerOf(s0.site.office);
    orderRows.push({ id, tenant_id: tenantId, client_id: s0.site.clientId, facility_id: s0.site.id, channel,
      requested_by_name: contact?.name ?? pick(['After-hours coordinator', 'Ward clerk', 'Nurse in charge', 'Rostering']),
      requested_by_email: contact?.email ?? null, requested_by_phone: null,
      client_reference: c.refPrefix && chance(0.75) ? `${c.refPrefix}${Math.floor(between(10000, 99999))}` : null,
      notes: chance(0.1) ? pick(ORDER_NOTES) : null, confirm_to_client: chance(0.88), created_by: officer.id, created_at: t0, contact_id: contact?.id ?? null });
    for (const s of group) { s.t0 = t0; s.orderId = id; }
  }
  const orderById = new Map(orderRows.map(o => [o.id as string, o]));

  // ---- Each shift's story: offers, calls, messages, bookings, pull-outs, cancellations ------------------------------
  const shiftRows: Row[] = [];
  const assignRows: Row[] = [];
  const offerRows: Row[] = [];
  const changeRows: Row[] = [];
  const callRows: Row[] = [];
  const noteRows: Row[] = [];
  const confirmRows: Row[] = [];
  const dutyRows: Row[] = [];
  const wkStart = (s: Shift) => mondayOf(s.date);
  const change = (s: Shift, kind: string, when: Date, by: { id: string | null; name: string; via: string }, worker: Worker | null = null, detail: string | null = null) =>
    changeRows.push({ tenant_id: tenantId, shift_id: s.id, facility_id: s.site.id, week_start: wkStart(s), kind, worker_id: worker?.id ?? null, equipment_id: null,
      detail, after_publish: false, actor_id: by.id, actor_name: by.name, via: by.via, at: when });
  const asOfficer = (o: Officer) => ({ id: o.id, name: o.name, via: 'office' });
  const asApp = (w: Worker) => ({ id: null, name: w.name, via: 'app' });
  const dayWords = (s: Shift) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: s.site.zone }).format(s.startsAt);
  const message = (s: Shift, w: Worker, template: string, when: Date, by: Officer) => {
    if (when.getTime() > nowMs) return;
    const subject = template === 'shift_offer' ? `Shift available: ${dayWords(s)} ${s.start}–${s.end}, ${s.site.def.name}` : `Booked: ${dayWords(s)} ${s.start}–${s.end}, ${s.site.def.name}`;
    noteRows.push({ id: randomUUID(), tenant_id: tenantId, channel: 'email', to_address: w.email, template, dedupe_key: null, subject,
      body: `Hi ${w.first},\n\n${subject} (${s.role}, ${s.areaName}).\n\nOpen CROP to reply.`, worker_id: w.id, status: 'sent', attempts: 1,
      next_attempt_at: when, created_by: by.id, created_at: when, sent_at: new Date(when.getTime() + 4000) });
  };
  const call = (by: Officer, when: Date, outcome: string, s: Shift | null, w: Worker | null, client: { id: string; contact?: string } | null, note: string | null, direction = 'out') => {
    if (when.getTime() > nowMs) return;
    callRows.push({ id: randomUUID(), tenant_id: tenantId, user_id: by.id, user_name: by.name, at: when, direction, worker_id: w?.id ?? null,
      client_id: client?.id ?? null, contact_id: null, contact_name: client?.contact ?? null, shift_id: s?.id ?? null, outcome, note });
  };
  const offerPool = (s: Shift, except: (Worker | null)[], n: number) => {
    const out: Worker[] = [];
    for (const w of [...workers].sort(() => rnd() - 0.5)) {
      if (out.length >= n) break;
      if (!except.includes(w) && canWork(w, s, { busy: s.phase === 'past' ? false : undefined })) out.push(w);
    }
    return out;
  };
  const REASONS: Record<string, string[]> = {
    client_cancelled: ['Client cancelled: fewer residents than expected', 'Client cancelled: beds closed', 'Client cancelled: covered by their own staff'],
    client_withdrew: ['Client withdrew the request', 'Client withdrew: entered by mistake on their side'],
    our_mistake: ['Entered twice by mistake'],
    not_filled: ["Couldn't fill: nobody available", "Couldn't fill at short notice"],
  };

  for (const s of all) {
    const order = orderById.get(s.orderId!)!;
    const t0 = s.t0!.getTime();
    const start = s.startsAt.getTime();
    const officer = officerOf(s.site.office);
    const deadline = Math.min(start - 15 * MIN, nowMs - MIN);
    let status = 'open';
    let lastAt = t0;
    let clientConfirmedAt: Date | null = null;
    let clientConfirmedBy: string | null = null;
    change(s, 'created', s.t0!, asOfficer(order.created_by === officer.id ? officer : officers.find(o => o.id === order.created_by)!));
    if (order.channel === 'phone') call(officer, s.t0!, 'answered', s, null, { id: s.site.clientId, contact: order.requested_by_name as string }, 'Order taken by phone', 'in');
    if (s.duty) dutyRows.push({ tenant_id: tenantId, shift_id: s.id, duty_id: duties.get(s.duty), created_at: s.t0 });

    // Someone who was on it and pulled out.
    if (s.pulled) {
      const p = s.pulled;
      const on = at(t0 + 5 * MIN, s.phase === 'past' ? start - 30 * HOUR : nowMs - 10 * HOUR);
      const off = s.phase === 'past' ? at(on.getTime() + 30 * MIN, start - 2 * HOUR) : s.relative ? at(nowMs - 40 * MIN, nowMs - 5 * MIN) : at(nowMs - 9 * HOUR, nowMs - 20 * MIN);
      assignRows.push({ id: randomUUID(), tenant_id: tenantId, shift_id: s.id, resource_kind: 'worker', worker_id: p.id, status: 'removed', assigned_by: officer.id,
        created_at: on, ended_at: off, equipment_id: null, removed_reason: 'pulled_out' });
      change(s, 'booked', on, asApp(p), p);
      const byApp = chance(0.5);
      change(s, 'pulled_out', off, byApp ? asApp(p) : asOfficer(officer), p);
      if (!byApp) call(officer, new Date(off.getTime() - 2 * MIN), 'answered', s, p, null, "Can't make it any more");
      lastAt = off.getTime();
    }

    if (s.worker) {
      const w = s.worker;
      const viaOffer = s.fate === 'accepted' ? chance(0.5) : chance(0.58);
      const fromT = Math.max(t0, lastAt) + 3 * MIN;
      const recent = s.fate === 'accepted' || s.fate === 'worker_to_confirm';
      const onAt = recent ? at(Math.max(fromT, nowMs - 5 * HOUR), deadline) : at(fromT + 10 * MIN, Math.min(deadline, fromT + 20 * HOUR));
      if (viaOffer) {
        const others = offerPool(s, [w, s.pulled], Math.floor(between(1, 7)));
        const sentAt = new Date(Math.max(fromT, onAt.getTime() - between(15, 240) * MIN));
        for (const o of [w, ...others]) {
          const mine = o === w;
          const declined = !mine && chance(0.4);
          const replied = mine ? onAt : declined ? at(sentAt.getTime() + 5 * MIN, onAt.getTime()) : onAt;
          offerRows.push({ id: randomUUID(), tenant_id: tenantId, shift_id: s.id, worker_id: o.id, status: mine ? 'accepted' : declined ? 'declined' : 'filled',
            expires_at: null, offered_by: officer.id, created_at: sentAt, responded_at: replied, responded_by: null, responded_via: mine || declined ? 'app' : null });
          message(s, o, 'shift_offer', sentAt, officer);
        }
      } else if (chance(0.6)) {
        call(officer, new Date(onAt.getTime() - 3 * MIN), 'said_yes', s, w, null, chance(0.3) ? pick(CALL_NOTES_WORKER) : null);
      }
      const confirmed = s.fate === 'booked' || s.fate === 'client_to_confirm';
      // Accepting an offer books at once; the office's own allocations wait for the person to confirm.
      const bookedAt = viaOffer ? onAt : at(onAt.getTime() + 5 * MIN, Math.min(deadline, onAt.getTime() + 8 * HOUR));
      assignRows.push({ id: randomUUID(), tenant_id: tenantId, shift_id: s.id, resource_kind: 'worker', worker_id: w.id, status: confirmed ? 'confirmed' : 'assigned',
        assigned_by: officer.id, created_at: onAt, ended_at: null, equipment_id: null, removed_reason: null });
      if (confirmed && viaOffer) change(s, 'booked', onAt, asApp(w), w);
      else {
        change(s, 'assigned', onAt, asOfficer(officer), w);
        if (confirmed) change(s, 'confirmed', bookedAt, chance(0.6) ? asApp(w) : asOfficer(officer), w);
      }
      if (confirmed) message(s, w, 'shift_booked', bookedAt, officer);
      status = confirmed ? 'booked' : 'assigned';
      lastAt = (confirmed ? bookedAt : onAt).getTime();
      if (s.site.client.confirms && (s.fate === 'booked' || s.fate === 'worker_to_confirm')) {
        clientConfirmedAt = at(lastAt + 2 * MIN, Math.min(deadline, lastAt + 4 * HOUR));
        clientConfirmedBy = (order.requested_by_name as string) ?? 'Client';
        lastAt = Math.max(lastAt, clientConfirmedAt.getTime());
      }
      if (confirmed && order.confirm_to_client && order.requested_by_email) {
        confirmRows.push({ id: randomUUID(), tenant_id: tenantId, order_id: order.id, shift_id: s.id, worker_id: w.id, notification_id: null,
          sent_at: new Date(Math.min(bookedAt.getTime() + MIN, nowMs - 10_000)), starts_at: s.startsAt, ends_at: s.endsAt, area_id: s.areaId });
      }
    } else if (s.fate === 'unfilled') {
      // Ended open: offers went out and nobody took it (they ran out at the start), the office rang round too.
      const from = Math.max(t0, lastAt) + 5 * MIN;
      const sentAt = at(from, Math.max(from, start - 2 * HOUR));
      for (const o of offerPool(s, [s.pulled], Math.floor(between(2, 9)))) {
        const declined = chance(0.55);
        offerRows.push({ id: randomUUID(), tenant_id: tenantId, shift_id: s.id, worker_id: o.id, status: declined ? 'declined' : 'pending',
          expires_at: declined ? null : new Date(start), offered_by: officer.id, created_at: sentAt,
          responded_at: declined ? at(sentAt.getTime() + 4 * MIN, start - 10 * MIN) : null, responded_by: null, responded_via: declined ? 'app' : null });
        message(s, o, 'shift_offer', sentAt, officer);
        if (chance(0.3)) call(officer, at(sentAt.getTime() + 10 * MIN, start - 15 * MIN), pick(['no_answer', 'left_message', 'said_no']), s, o, null, null);
      }
      lastAt = sentAt.getTime();
    } else if (s.fate === 'released' || (s.fate === 'pulled_out' && chance(0.6))) {
      const n = s.fate === 'released' ? Math.floor(between(3, 13)) : Math.floor(between(2, 6));
      const sentAt = at(Math.max(t0, lastAt) + 2 * MIN, Math.max(t0, lastAt) + 50 * MIN);
      for (const o of offerPool(s, [s.pulled], n)) {
        const declined = chance(0.18);
        offerRows.push({ id: randomUUID(), tenant_id: tenantId, shift_id: s.id, worker_id: o.id, status: declined ? 'declined' : 'pending', expires_at: null,
          offered_by: officer.id, created_at: sentAt, responded_at: declined ? at(sentAt.getTime() + 4 * MIN, nowMs) : null, responded_by: null, responded_via: declined ? 'app' : null });
        message(s, o, 'shift_offer', sentAt, officer);
        if (chance(0.12)) call(officer, at(sentAt.getTime() + 10 * MIN, nowMs), pick(['no_answer', 'left_message', 'said_no', 'no_answer']), s, o, null, null);
      }
      lastAt = sentAt.getTime();
    }

    let cancelKind: string | null = null;
    let cancelReason: string | null = null;
    if (['client_cancelled', 'client_withdrew', 'our_mistake', 'not_filled'].includes(s.fate)) {
      cancelKind = s.fate;
      cancelReason = pick(REASONS[s.fate]);
      const when = s.fate === 'not_filled' ? at(start - 3 * HOUR, start - 30 * MIN) : s.phase === 'past' ? at(t0 + 30 * MIN, start - HOUR) : at(Math.max(t0 + 10 * MIN, nowMs - 20 * HOUR), nowMs);
      if (s.hadPerson) {
        const on = at(t0 + 5 * MIN, when.getTime() - 10 * MIN);
        assignRows.push({ id: randomUUID(), tenant_id: tenantId, shift_id: s.id, resource_kind: 'worker', worker_id: s.hadPerson.id, status: 'removed', assigned_by: officer.id,
          created_at: on, ended_at: when, equipment_id: null, removed_reason: null });
        change(s, 'booked', on, asApp(s.hadPerson), s.hadPerson);
      }
      change(s, 'cancelled', when, asOfficer(officer), null, cancelReason);
      if (s.fate.startsWith('client')) call(officer, new Date(when.getTime() - MIN), 'answered', s, null, { id: s.site.clientId, contact: order.requested_by_name as string }, 'Client rang to cancel', 'in');
      status = 'cancelled';
      lastAt = when.getTime();
    }

    shiftRows.push({ id: s.id, tenant_id: tenantId, facility_id: s.site.id, area_id: s.areaId, shift_code_id: s.codeId, role: s.role, starts_at: s.startsAt, ends_at: s.endsAt,
      break_minutes: s.brk, status, notes: s.notes, cancelled_reason: cancelReason, created_by: order.created_by, created_at: s.t0, updated_at: new Date(Math.min(lastAt, nowMs)),
      needs_person: true, covering_worker_id: null, gender_requested: s.gender, client_order_id: s.orderId, client_confirmed_at: clientConfirmedAt,
      client_confirmed_by: clientConfirmedBy, client_confirmed_worker_id: clientConfirmedAt ? s.worker!.id : null, usual_worker_id: s.usual?.id ?? null, cancel_kind: cancelKind });
    if (s.usual) change(s, 'usual_set', s.t0!, asOfficer(officer), s.usual);
  }

  // Requests for a day from the app: open for the coming days, a few answered.
  const dayReqRows: Row[] = [];
  const upcoming = all.filter(s => s.worker && s.phase !== 'past' && s.phase !== 'started');
  for (let i = 0; i < 34; i++) {
    const s = pick(upcoming);
    if (!s) break;
    const w = s.worker!;
    const kind = pick(['prefer_am', 'prefer_pm', 'finish_by', 'start_after', 'other', 'prefer_am']);
    const answered = i >= 26;
    const asked = new Date(nowMs - between(1, 72) * HOUR);
    dayReqRows.push({ id: randomUUID(), tenant_id: tenantId, worker_id: w.id, on_date: s.date, kind,
      at_time: kind === 'finish_by' ? pick(['14:00', '15:00', '20:00']) : kind === 'start_after' ? pick(['09:00', '10:00']) : null,
      note: kind === 'other' ? pick(DAY_REQUEST_NOTES) : null, status: answered ? pick(['done', 'not_possible']) : 'open', created_via: 'app', created_by: null,
      created_at: asked, decided_at: answered ? new Date(Math.min(asked.getTime() + 2 * HOUR, nowMs - MIN)) : null, decided_by: answered ? lead.id : null,
      decided_by_name: answered ? lead.name : null, decided_note: null });
  }

  await put('client_orders', orderRows);
  await put('shifts', shiftRows);
  await put('shift_duty_links', dutyRows);
  await put('shift_assignments', assignRows);
  await put('shift_offers', offerRows);
  await put('shift_changes', changeRows.sort((a, b) => (a.at as Date).getTime() - (b.at as Date).getTime()));
  await put('notifications', noteRows);
  await put('call_logs', callRows);
  await put('client_order_confirmations', confirmRows);
  await put('day_requests', dayReqRows);
  return counts;
}
