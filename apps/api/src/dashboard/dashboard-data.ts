import type { PoolClient } from 'pg';
import { addDays } from '../workforce/compliance.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from '../workforce/compliance-data.js';
import { onboardingProgress } from '../workforce/onboarding.controller.js';
import { BOARD_STAGES, STAGE_LABEL } from '../workforce/recruitment.js';
import { kpiByKey, median, percent } from './kpis.js';

/** A measure's value plus a short line of detail (e.g. "3 left to fill"). */
export interface Measured { value: number | null; detail?: string; breakdown?: { label: string; value: number }[] }

const PERSON_SHIFT = `s.needs_person and s.status <> 'cancelled'`;
const hoursOf = `greatest(extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0, 0)`;
const n = (r: { n: number | string | null } | undefined) => Number(r?.n ?? 0);
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** The business's own targets (kpi → value). */
export async function targetsOf(db: PoolClient): Promise<Map<string, number>> {
  const rows = (await db.query<{ kpi: string; value: string }>('select kpi, value from dashboard_targets')).rows;
  return new Map(rows.map(r => [r.kpi, Number(r.value)]));
}

/** Each measure, worked out from live data inside withTenant. `blockedShifts` comes from Needs attention. */
export const MEASURES: Record<string, (db: PoolClient, x: { tenantId: string; targets: Map<string, number>; blockedShifts: () => Promise<number> }) => Promise<Measured>> = {
  async filled_48h(db) {
    const r = (await db.query<{ total: number; filled: number }>(
      `select count(*)::int as total, count(*) filter (where s.status in ('assigned', 'booked'))::int as filled
         from shifts s where ${PERSON_SHIFT} and s.starts_at > now() and s.starts_at <= now() + interval '48 hours'`)).rows[0];
    const left = r.total - r.filled;
    return { value: percent(r.filled, r.total), detail: r.total ? (left ? `${left} of ${r.total} still to fill` : `All ${r.total} filled`) : 'Nothing in the next 48 hours' };
  },

  async time_to_fill(db) {
    const rows = (await db.query<{ hours: number }>(
      `select extract(epoch from (c.at - o.at)) / 3600 as hours
         from shift_changes c join shifts s on s.id = c.shift_id
         join lateral (select max(x.at) as at from shift_changes x
                        where x.shift_id = c.shift_id and x.kind in ('created', 'unassigned', 'pulled_out') and x.at <= c.at) o on o.at is not null
        where c.kind in ('assigned', 'booked') and c.at > now() - interval '28 days' and s.needs_person
          and c.at - o.at >= interval '1 minute'`)).rows;
    const m = median(rows.map(r => Number(r.hours)));
    return { value: m, detail: rows.length ? `From ${plural(rows.length, 'fill', 'fills')} in 4 weeks` : 'No shifts filled after being open in 4 weeks' };
  },

  async last_minute_gaps(db) {
    const r = (await db.query<{ n: number }>(
      `select count(distinct c.shift_id)::int as n from shift_changes c join shifts s on s.id = c.shift_id
        where c.at > now() - interval '7 days' and s.needs_person
          and c.kind in ('created', 'unassigned', 'pulled_out')
          and s.starts_at > c.at and s.starts_at - c.at <= interval '24 hours'
          and not (c.kind = 'created' and exists (select 1 from shift_changes y where y.shift_id = c.shift_id
                     and y.kind in ('assigned', 'booked') and y.at = c.at))`)).rows[0];
    return { value: n(r), detail: 'Last 7 days' };
  },

  async offer_acceptance(db) {
    const r = (await db.query<{ accepted: number; total: number }>(
      `select count(*) filter (where status = 'accepted')::int as accepted,
              count(*) filter (where status in ('accepted', 'declined') or (status = 'pending' and expires_at <= now()))::int as total
         from shift_offers where created_at > now() - interval '28 days'`)).rows[0];
    return { value: percent(r.accepted, r.total), detail: r.total ? `${r.accepted} of ${plural(r.total, 'answered or run-out offer', 'answered or run-out offers')}` : 'No offers answered in 4 weeks' };
  },

  async agency_share(db, x) {
    const today = (await complianceContext(db, x.tenantId)).today;
    const monthStart = `${today.slice(0, 8)}01`;
    const r = (await db.query<{ total: string; agency: string }>(
      `select coalesce(sum(${hoursOf}), 0) as total, coalesce(sum(${hoursOf}) filter (where w.status = 'agency'), 0) as agency
         from shifts s join shift_assignments a on a.shift_id = s.id and a.resource_kind = 'worker' and a.status in ('assigned', 'confirmed')
         join workers w on w.id = a.worker_id
        where ${PERSON_SHIFT} and s.starts_at >= $1::date and s.starts_at < ($1::date + interval '1 month')`, [monthStart])).rows[0];
    const total = Number(r.total); const agency = Number(r.agency);
    return { value: percent(agency, total), detail: total ? `${Math.round(agency)} of ${Math.round(total)} filled hours this month` : 'No filled hours this month' };
  },

  async ready_to_work(db, x) {
    const ctx = await complianceContext(db, x.tenantId);
    const workers = (await db.query<{ id: string; roles: string[] }>(`select id, roles from workers where status = 'active'`)).rows;
    const facts = await credentialFactsByWorker(db);
    const rtw = await rightToWorkByWorker(db);
    const missing = new Map<string, number>();
    let ready = 0;
    for (const w of workers) {
      const c = ctx.evaluate(w.roles, facts.get(w.id) ?? [], rtw.get(w.id) ?? null);
      if (c.status !== 'non_compliant') { ready++; continue; }
      for (const i of c.issues.filter(i => i.severity === 'hard' && i.problem !== 'expiring')) {
        const label = i.typeName || 'Right to work';
        missing.set(label, (missing.get(label) ?? 0) + 1);
      }
    }
    const breakdown = [...missing.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);
    return { value: percent(ready, workers.length), detail: workers.length ? `${workers.length - ready} of ${workers.length} not ready` : 'No active people yet', breakdown };
  },

  async blocked_shifts(_db, x) {
    return { value: await x.blockedShifts(), detail: 'Next 7 days' };
  },

  async waiting_to_check(db) {
    const r = (await db.query<{ n: number; oldest: number | null }>(
      `select count(*)::int as n, floor(extract(epoch from (now() - min(c.created_at))) / 86400)::int as oldest
         from worker_credentials c join workers w on w.id = c.worker_id
        where c.verification = 'unverified' and w.status = 'active'`)).rows[0];
    return { value: n(r), detail: r.n ? (r.oldest ? `Oldest waiting ${plural(r.oldest, 'day', 'days')}` : 'Oldest sent in today') : 'Nothing waiting' };
  },

  async expiring_before_shift(db, x) {
    const today = (await complianceContext(db, x.tenantId)).today;
    const r = (await db.query<{ n: number; soonest: string | null }>(
      `select count(*)::int as n, to_char(min(c.expiry_date), 'YYYY-MM-DD') as soonest
         from worker_credentials c join workers w on w.id = c.worker_id
        where c.verification = 'verified' and w.status = 'active' and c.expiry_date between $1::date and $2::date
          and exists (select 1 from shift_assignments a join shifts s on s.id = a.shift_id
                       where a.worker_id = c.worker_id and a.resource_kind = 'worker' and a.status in ('assigned', 'confirmed')
                         and s.status <> 'cancelled' and s.starts_at >= c.expiry_date + 1)`, [today, addDays(today, 30)])).rows[0];
    return { value: n(r), detail: r.n ? `First runs out ${r.soonest}` : 'None in the next 30 days' };
  },

  async check_turnaround(db) {
    const rows = (await db.query<{ hours: number }>(
      `select extract(epoch from (e.at - p.at)) / 3600 as hours
         from credential_events e
         join lateral (select max(x.at) as at from credential_events x where x.worker_credential_id = e.worker_credential_id
                         and x.action in ('created', 'updated', 'verification_reset') and x.at <= e.at) p on p.at is not null
        where e.action in ('verified', 'rejected') and e.at > now() - interval '28 days' and e.at - p.at >= interval '1 minute'`)).rows;
    return { value: median(rows.map(r => Number(r.hours))), detail: rows.length ? `From ${plural(rows.length, 'check', 'checks')} in 4 weeks` : 'Nothing checked in 4 weeks' };
  },

  async applied_to_started(db) {
    const rows = (await db.query<{ days: number }>(
      `select extract(epoch from (st.at - ap.at)) / 86400 as days
         from recruitment_events st
         join lateral (select min(x.at) as at from recruitment_events x where x.worker_id = st.worker_id and x.to_stage = 'applied') ap on ap.at is not null
        where st.to_stage = 'started' and st.at > now() - interval '90 days'`)).rows;
    return { value: median(rows.map(r => Number(r.days))), detail: rows.length ? `From ${plural(rows.length, 'starter', 'starters')} in 90 days` : 'Nobody started in 90 days' };
  },

  async stuck(db, x) {
    const limit = x.targets.get('stage_limit_days') ?? kpiByKey('stage_limit_days')!.suggested;
    const rows = (await db.query<{ stage: string; n: number }>(
      `select coalesce(recruitment_stage, 'applied') as stage, count(*)::int as n from workers
        where status = 'applicant' and stage_changed_at < now() - make_interval(days => $1) group by 1`, [Math.floor(limit)])).rows;
    const total = rows.reduce((s, r) => s + r.n, 0);
    const most = [...rows].sort((a, b) => b.n - a.n)[0];
    const label = (s: string) => STAGE_LABEL[s as keyof typeof STAGE_LABEL] ?? s;
    return {
      value: total,
      detail: total ? `Most at ${label(most.stage)} · over ${plural(limit, 'day', 'days')}` : `Nobody over ${plural(limit, 'day', 'days')} at a stage`,
      breakdown: rows.map(r => ({ label: label(r.stage), value: r.n })),
    };
  },

  async starting_soon(db, x) {
    const live = (await db.query<{ id: string }>(
      `select o.id from worker_onboardings o join workers w on w.id = o.worker_id where o.finished_at is null and w.status = 'onboarding'`)).rows;
    let ready = 0;
    for (const o of live) if (((await onboardingProgress(db, x.tenantId, o.id)).summary as { ready: boolean }).ready) ready++;
    return { value: ready, detail: live.length ? `${ready} of ${live.length} being onboarded` : 'Nobody being onboarded' };
  },

  async started_unfilled(db) {
    const rows = (await db.query<{ role: string; n: number }>(
      `select s.role, count(*)::int as n from shifts s
        where ${PERSON_SHIFT} and s.status = 'open' and s.starts_at < now() and s.starts_at > now() - interval '28 days'
        group by s.role order by 2 desc, 1`)).rows;
    const total = rows.reduce((s, r) => s + r.n, 0);
    return { value: total, detail: total ? `Most: ${rows[0].role}` : 'None in 4 weeks', breakdown: rows.slice(0, 5).map(r => ({ label: r.role, value: r.n })) };
  },

  // The agency's side (its own copies of employers' requests, `agency_inbox`).
  async agency_open(db) {
    const r = (await db.query<{ n: number; soon: number }>(
      `select count(*)::int as n, count(*) filter (where starts_at < now() + interval '24 hours')::int as soon from agency_inbox
        where status = 'open' and placed_worker_id is null and starts_at > now() and starts_at < now() + interval '7 days'`)).rows[0];
    return { value: r.n, detail: r.n ? (r.soon ? `${r.soon} within a day` : 'None within a day') : 'Nothing waiting on us' };
  },

  async agency_filled(db) {
    const r = (await db.query<{ won: number; total: number }>(
      `select count(*) filter (where placed_at is not null)::int as won, count(*)::int as total from agency_inbox
        where received_at > now() - interval '28 days'`)).rows[0];
    return { value: percent(r.won, r.total), detail: r.total ? `${r.won} of ${plural(r.total, 'request', 'requests')} in 4 weeks` : 'No requests in 4 weeks' };
  },

  async agency_response(db) {
    const rows = (await db.query<{ hours: number }>(
      `select extract(epoch from (placed_at - received_at)) / 3600 as hours from agency_inbox
        where placed_at is not null and placed_at > now() - interval '28 days'`)).rows;
    return { value: median(rows.map(r => Number(r.hours))), detail: rows.length ? `From ${plural(rows.length, 'request', 'requests')} in 4 weeks` : 'Nobody put forward in 4 weeks' };
  },

  async agency_pulled_out(db) {
    const r = (await db.query<{ n: number }>(
      `select count(*)::int as n from agency_inbox where placement = 'pulled_out' and placement_at > now() - interval '28 days'`)).rows[0];
    return { value: n(r), detail: 'Last 4 weeks' };
  },

  async agency_waiting(db) {
    const r = (await db.query<{ n: number }>(
      `select count(*)::int as n from agency_inbox where placement = 'waiting' and status <> 'withdrawn' and starts_at > now()`)).rows[0];
    return { value: n(r), detail: r.n ? 'Employers still to approve' : 'Nobody waiting' };
  },
};

/** Whether the business supplies employers through CROP (so it may have the Agency dashboard). */
export async function suppliesEmployers(db: PoolClient): Promise<boolean> {
  return !!(await db.query(`select 1 from agency_connections where side = 'agency' and status <> 'ended' limit 1`)).rowCount;
}

/** Recruitment funnel: people who reached each stage in the last 90 days and how many went further. */
export async function funnel(db: PoolClient) {
  const order = [...BOARD_STAGES, 'onboarding', 'started'] as const;
  const rows = (await db.query<{ worker_id: string; to_stage: string }>(
    `select worker_id, to_stage from recruitment_events where at > now() - interval '90 days' and to_stage = any($1)`, [order])).rows;
  const reached = new Map<string, Set<string>>(order.map(s => [s, new Set()]));
  for (const r of rows) reached.get(r.to_stage)!.add(r.worker_id);
  return order.map((stage, i) => {
    const here = reached.get(stage)!;
    const later = new Set(order.slice(i + 1).flatMap(s => [...reached.get(s)!]));
    const movedOn = [...here].filter(w => later.has(w)).length;
    return { stage, label: STAGE_LABEL[stage], reached: here.size, movedOn: i < order.length - 1 ? movedOn : null, conversion: i < order.length - 1 ? percent(movedOn, here.size) : null };
  });
}

/** Keeps today's value of a measure (the latest worked out today wins), for "a week ago" and trend lines. */
export async function saveSnapshot(db: PoolClient, tenantId: string, day: string, kpi: string, value: number | null) {
  await db.query(
    `insert into dashboard_snapshots(tenant_id, day, kpi, value) values ($1,$2,$3,$4)
     on conflict (tenant_id, kpi, day) do update set value = excluded.value, updated_at = now()`, [tenantId, day, kpi, value]);
}

/** Each measure's values on the weekly days from `trendDays` (null where nothing was kept that day). */
export async function history(db: PoolClient, keys: string[], days: string[]): Promise<Map<string, (number | null)[]>> {
  const rows = (await db.query<{ kpi: string; day: string; value: string | null }>(
    `select kpi, to_char(day, 'YYYY-MM-DD') as day, value from dashboard_snapshots where kpi = any($1) and day = any($2::date[])`, [keys, days])).rows;
  const by = new Map(rows.map(r => [`${r.kpi}:${r.day}`, r.value === null ? null : Number(r.value)]));
  return new Map(keys.map(k => [k, days.map(d => by.get(`${k}:${d}`) ?? null)]));
}
