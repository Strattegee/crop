import type { PoolClient } from 'pg';
import { credentialFactsByWorker } from '../workforce/compliance-data.js';
import { credentialStatus, type CredentialFacts } from '../workforce/compliance.js';
import { coverGaps, coverGapWords, type CoverShift } from './cover.js';

/** A gap in a cover rule, as the office sees it (local times in the site's time zone). */
export interface CoverGapRow {
  ruleId: string;
  facilityId: string;
  facilityName: string;
  credentialTypeId: string;
  typeName: string;
  from: Date;
  to: Date;
  /** The local date the gap starts on, and its local start and end ("02:00 next day" when it ends the next day). */
  localDate: string;
  localFrom: string;
  localTo: string;
  /** A shift being worked when the gap starts (opens it on the roster), and every shift worked during the gap. */
  shiftId: string;
  shiftIds: string[];
  title: string;
  detail: string;
}

/** Holds a verified credential of the type that hasn't run out by `onDate`. */
export function holdsOn(creds: CredentialFacts[], credentialTypeId: string, onDate: string): boolean {
  return creds.some(c => c.credentialTypeId === credentialTypeId && c.verification === 'verified' && credentialStatus(c.expiryDate, onDate, 0) !== 'expired');
}

function local(at: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Gaps in the business's active cover rules among shifts that overlap [from, to) (within withTenant), at one site
 * or all. Shifts are taken whole, so a gap can start before `from`; callers trim to what they show.
 */
export async function coverGapsBetween(db: PoolClient, from: Date, to: Date, facilityId: string | null): Promise<CoverGapRow[]> {
  const rules = (await db.query<{ id: string; facility_id: string | null; credential_type_id: string; type_name: string }>(
    `select r.id, r.facility_id, r.credential_type_id, ct.name as type_name
       from site_cover_rules r join credential_types ct on ct.id = r.credential_type_id
      where r.active and ct.active and ($1::uuid is null or r.facility_id is null or r.facility_id = $1)
      order by r.facility_id nulls first, ct.name`, [facilityId])).rows;
  if (!rules.length) return [];

  const shifts = (await db.query<{ id: string; facility_id: string; facility_name: string; timezone: string; starts_at: Date; ends_at: Date; local_date: string; worker_id: string }>(
    `select s.id, s.facility_id, f.name as facility_name, f.timezone, s.starts_at, s.ends_at, sa.worker_id,
            to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as local_date
       from shifts s join facilities f on f.id = s.facility_id
       join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
      where s.status <> 'cancelled' and s.needs_person and s.starts_at < $2 and s.ends_at > $1
        and ($3::uuid is null or s.facility_id = $3)
      order by s.starts_at, s.id`, [from, to, facilityId])).rows;
  if (!shifts.length) return [];
  const creds = await credentialFactsByWorker(db, [...new Set(shifts.map(s => s.worker_id))]);

  const bySite = new Map<string, typeof shifts>();
  for (const s of shifts) bySite.set(s.facility_id, [...(bySite.get(s.facility_id) ?? []), s]);

  const out: CoverGapRow[] = [];
  for (const [siteId, list] of bySite) {
    // A site's own rule and a business-wide rule for the same credential are one rule there.
    const seen = new Set<string>();
    for (const rule of rules) {
      if ((rule.facility_id && rule.facility_id !== siteId) || seen.has(rule.credential_type_id)) continue;
      seen.add(rule.credential_type_id);
      const cover: CoverShift[] = list.map(s => ({
        id: s.id, startsAt: s.starts_at, endsAt: s.ends_at, holds: holdsOn(creds.get(s.worker_id) ?? [], rule.credential_type_id, s.local_date),
      }));
      const { facility_name: facilityName, timezone } = list[0];
      for (const g of coverGaps(cover)) {
        const start = local(g.from, timezone);
        const end = local(g.to, timezone);
        const localTo = end.date === start.date ? end.time : `${end.time} next day`;
        const at = cover.filter(s => g.shiftIds.includes(s.id));
        const opens = at.find(s => s.startsAt.getTime() >= g.from.getTime()) ?? at[0];
        out.push({
          ruleId: rule.id, facilityId: siteId, facilityName, credentialTypeId: rule.credential_type_id, typeName: rule.type_name,
          from: g.from, to: g.to, localDate: start.date, localFrom: start.time, localTo, shiftId: opens.id, shiftIds: g.shiftIds,
          ...coverGapWords(rule.type_name, facilityName, start.time, localTo),
        });
      }
    }
  }
  return out.sort((a, b) => a.from.getTime() - b.from.getTime() || a.facilityName.localeCompare(b.facilityName) || a.typeName.localeCompare(b.typeName));
}
