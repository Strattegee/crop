/**
 * The employee card (David, 31 Oct): a compact summary of a person, the same everywhere it appears (the person's
 * page, the worker list, later the recruitment board and the roster). Pure rules here; the data in `cardsFor`.
 */
import type { PoolClient } from 'pg';
import { addDays } from './compliance.js';

export interface CardCredential {
  typeName: string;
  expiryDate: string | null;
  verification: 'unverified' | 'verified' | 'rejected';
}

export interface CardFacts {
  /** The soonest date something runs out (a verified credential or the visa), today or later. */
  nextExpiry: { name: string; date: string } | null;
  /** Verified credentials that haven't run out today, by name (shown as badges). */
  held: string[];
  /** Credentials recorded but not checked yet. */
  toCheck: number;
}

/** What the card says about a person's credentials and visa on `today` (YYYY-MM-DD). */
export function cardFacts(creds: CardCredential[], visaExpiry: string | null, today: string): CardFacts {
  const current = creds.filter(c => c.verification === 'verified' && (!c.expiryDate || c.expiryDate >= today));
  const held = [...new Set(current.map(c => c.typeName))].sort((a, b) => a.localeCompare(b));
  const dates = current.filter(c => c.expiryDate).map(c => ({ name: c.typeName, date: c.expiryDate! }));
  if (visaExpiry && visaExpiry >= today) dates.push({ name: 'Visa', date: visaExpiry });
  dates.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { nextExpiry: dates[0] ?? null, held, toCheck: creds.filter(c => c.verification === 'unverified').length };
}

export interface Card extends CardFacts {
  employmentType: string | null;
  contractedHours: number | null;
  /** Hours rostered Monday to Sunday this week (assigned or confirmed), in each site's own dates. */
  weekHours: number;
  /** The next shift that hasn't started, e.g. "Sat 1 Nov 06:00 · The Grand Café". */
  nextShift: { startsAt: string; label: string } | null;
}

/** Monday on or before a date (YYYY-MM-DD). */
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Cards for the given people (within withTenant). */
export async function cardsFor(db: PoolClient, ids: string[], today: string): Promise<Map<string, Card>> {
  const out = new Map<string, Card>();
  if (!ids.length) return out;
  for (const id of ids) out.set(id, { nextExpiry: null, held: [], toCheck: 0, employmentType: null, contractedHours: null, weekHours: 0, nextShift: null });

  const creds = new Map<string, CardCredential[]>();
  for (const r of (await db.query<CardCredential & { worker_id: string }>(
    `select c.worker_id, t.name as "typeName", to_char(c.expiry_date, 'YYYY-MM-DD') as "expiryDate", c.verification
       from worker_credentials c join credential_types t on t.id = c.credential_type_id where c.worker_id = any($1)`, [ids])).rows) {
    creds.set(r.worker_id, [...(creds.get(r.worker_id) ?? []), r]);
  }
  const visas = new Map((await db.query<{ worker_id: string; visa_expiry: string | null }>(
    `select worker_id, to_char(visa_expiry, 'YYYY-MM-DD') as visa_expiry from right_to_work_records
      where superseded_at is null and worker_id = any($1)`, [ids])).rows.map(r => [r.worker_id, r.visa_expiry]));
  for (const id of ids) Object.assign(out.get(id)!, cardFacts(creds.get(id) ?? [], visas.get(id) ?? null, today));

  for (const r of (await db.query<{ worker_id: string; employment_type: string; contracted_hours: number | null }>(
    `select distinct on (worker_id) worker_id, employment_type, contracted_hours::float8 as contracted_hours from employment_terms
      where worker_id = any($1) and withdrawn_at is null and starts_on <= $2 and (ends_on is null or ends_on >= $2)
      order by worker_id, starts_on desc`, [ids, today])).rows) {
    Object.assign(out.get(r.worker_id)!, { employmentType: r.employment_type, contractedHours: r.contracted_hours });
  }

  const monday = mondayOf(today);
  for (const r of (await db.query<{ worker_id: string; hours: number }>(
    `select sa.worker_id, sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0)::float8 as hours
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
      where sa.worker_id = any($1) and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
        and (s.starts_at at time zone f.timezone)::date between $2::date and $2::date + 6
      group by sa.worker_id`, [ids, monday])).rows) {
    out.get(r.worker_id)!.weekHours = Math.round(r.hours * 100) / 100;
  }

  for (const r of (await db.query<{ worker_id: string; starts_at: Date; label: string }>(
    `select distinct on (sa.worker_id) sa.worker_id, s.starts_at,
            to_char(s.starts_at at time zone f.timezone, 'Dy FMDD Mon HH24:MI') || ' · ' || f.name as label
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
      where sa.worker_id = any($1) and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
        and s.starts_at > now()
      order by sa.worker_id, s.starts_at`, [ids])).rows) {
    out.get(r.worker_id)!.nextShift = { startsAt: r.starts_at.toISOString(), label: r.label };
  }
  return out;
}
