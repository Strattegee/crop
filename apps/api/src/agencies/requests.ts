import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

/**
 * Agency fill (migration 0040): pure rules for when each agency gets a request and how a request reads.
 * Design: docs/decisions/2026-10-28-agency-connections-design.md (approved by David 29 Oct), build step 2.
 */

/**
 * Minutes between one agency and the next (David, 26 Oct): the shift starts within 2 hours → 10 minutes;
 * later the same day (the site's date) → 1 hour; the next day or later → 2 hours.
 */
export function escalationMinutes(startsAt: Date, now: Date, zone: string): number {
  const ms = startsAt.getTime() - now.getTime();
  if (ms <= 2 * 3600_000) return 10;
  return localDate(startsAt, zone) === localDate(now, zone) ? 60 : 120;
}

export const localDate = (d: Date, zone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** When each agency (in the employer's order) gets the request: the first now, each next one a step later. */
export function roundSchedule<L extends { connectionId: string; preference: number | null }>(
  links: L[], now: Date, stepMinutes: number,
): Array<L & { position: number; dueAt: Date }> {
  return [...links]
    .sort((a, b) => (a.preference ?? 999) - (b.preference ?? 999))
    .map((l, i) => ({ ...l, position: i + 1, dueAt: new Date(now.getTime() + i * stepMinutes * 60_000) }));
}

export type FillShift = {
  status: 'open' | 'assigned' | 'booked' | 'cancelled'; equipmentOnly: boolean; startsAt: Date;
};

/** Why this shift can't be sent to agencies now, in plain words, or null when it can. */
export function agencyFillProblem(shift: FillShift, activeAgencies: number, hasOpenRequest: boolean, now: Date, w: Words = DEFAULT_WORDS): string | null {
  const shiftWord = w.lower(T.shift);
  if (shift.status === 'cancelled') return `This ${shiftWord} has been cancelled`;
  if (shift.equipmentOnly) return `Nobody works an equipment-only ${shiftWord}, so it can't go to agencies`;
  if (shift.status !== 'open') return `Someone is already on this ${shiftWord}`;
  if (shift.startsAt.getTime() <= now.getTime()) return `This ${shiftWord} has already started`;
  if (hasOpenRequest) return `This ${shiftWord} has already been sent to agencies`;
  if (activeAgencies === 0) return 'No agency can be sent requests yet. Link an agency in Settings → Agencies; it can take requests once it has matched your requirements.';
  return null;
}

export type RoundState = 'sent' | 'waiting' | 'skipped';
export function roundState(r: { sentAt: Date | null; skippedAt: Date | null }): RoundState {
  return r.sentAt ? 'sent' : r.skippedAt ? 'skipped' : 'waiting';
}

/** "in 10 minutes", "in 2 hours", "in 1 hour 30 minutes", "now". */
export function inWords(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins === 0) return 'now';
  if (mins >= 48 * 60) return `in ${Math.round(mins / 1440)} days`;
  if (mins >= 24 * 60) {
    const h = Math.round((mins - 1440) / 60);
    return h ? `in 1 day ${h} hour${h === 1 ? '' : 's'}` : 'in 1 day';
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts = [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : ''].filter(Boolean);
  return `in ${parts.join(' ')}`;
}

export type InboxShift = {
  employerName: string; siteName: string; siteTimezone: string; areaName: string | null; role: string;
  startsAt: Date; endsAt: Date; duties: string[];
  requirements: Array<{ name: string; severity: 'hard' | 'warning' | 'optional'; forDuty: string | null; credentialTypeId: string | null }>;
  note: string | null;
};

/** "Tue 3 Nov" in the site's time zone. */
export function localDay(d: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

export function localWhen(s: { startsAt: Date; endsAt: Date; siteTimezone: string }): string {
  const day = localDay(s.startsAt, s.siteTimezone);
  const t = (d: Date) => new Intl.DateTimeFormat('en-AU', { timeZone: s.siteTimezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(' ', '').toLowerCase();
  return `${day}, ${t(s.startsAt)} to ${t(s.endsAt)}`;
}

/**
 * The email to the agency's owners and admins when a request arrives. Names the shift and the requirements still
 * to match; no people, no private details. Uses the agency's own words.
 */
export function requestArrivedEmail(s: InboxShift, appUrl: string | null, w: Words = DEFAULT_WORDS) {
  const where = [s.areaName, s.siteName].filter(Boolean).join(', ');
  const unmatched = s.requirements.filter(r => r.severity !== 'optional' && !r.credentialTypeId).length;
  const lines = [
    `${s.employerName} has asked you to fill a ${w.lower(T.shift)}:`,
    '',
    `${s.role} at ${where}`,
    localWhen(s),
    ...(s.duties.length ? [`Duties: ${s.duties.join(', ')}`] : []),
    ...(s.note ? [`Note from ${s.employerName}: ${s.note}`] : []),
    '',
    unmatched ? `${unmatched} of its requirements ${unmatched === 1 ? "isn't" : "aren't"} matched to your credentials yet.` : null,
    appUrl ? `See it in CROP: ${appUrl.replace(/\/$/, '')}/allocations` : 'See it in CROP under Allocations.',
  ].filter((l): l is string => l !== null);
  return { subject: `${s.employerName}: ${s.role} on ${localDay(s.startsAt, s.siteTimezone)}`, body: lines.join('\n') };
}

export type SnapshotRequirement = InboxShift['requirements'][number] & { requirementId?: string };

/**
 * The rules an agency checks its people against for a request: each must-have and should-have, as the agency's own
 * credential (its current match when the request carries the employer's requirement id, else the match it had when
 * the request arrived; removing a match since means it is unmatched). A must-have with no match blocks everyone (nobody can be checked against it); a should-have
 * with no match is listed. Optional ones are never checked.
 */
export function agencyRules(
  reqs: SnapshotRequirement[], liveMatch: Map<string, string>, ownTypeNames: Map<string, string>, employerName: string,
) {
  const rules: Array<{ credentialTypeId: string; typeName: string; scope: 'all_workers'; role: null; severity: 'hard' | 'warning'; forDuty?: string }> = [];
  const blockAll: string[] = [];
  const unmatched: Array<{ name: string; severity: 'hard' | 'warning' }> = [];
  for (const q of reqs) {
    if (q.severity === 'optional') continue;
    // The agency's current match is authoritative; requests sent before requirement ids were carried use the match they arrived with.
    const typeId = q.requirementId ? liveMatch.get(q.requirementId) ?? null : q.credentialTypeId ?? null;
    const typeName = typeId ? ownTypeNames.get(typeId) : undefined;
    if (!typeId || !typeName) {
      unmatched.push({ name: q.name, severity: q.severity });
      if (q.severity === 'hard') blockAll.push(`${employerName}'s ${q.name} isn't matched to your credentials yet`);
      continue;
    }
    rules.push({ credentialTypeId: typeId, typeName, scope: 'all_workers', role: null, severity: q.severity, ...(q.forDuty ? { forDuty: q.forDuty } : {}) });
  }
  return { rules, blockAll, unmatched };
}
