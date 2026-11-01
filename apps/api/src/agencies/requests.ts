import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

/**
 * Agency fill (migration 0040): pure rules for when each agency gets a request and how a request reads.
 * Design: docs/decisions/2026-10-28-agency-connections-design.md (approved by David 29 Oct), build step 2.
 */

/** How long each agency has a request before the next gets it too, per band (tenant_settings, migration 0045). */
export type AgencyTiming = { soonMinutes: number; todayMinutes: number; laterMinutes: number };
/** David's defaults (26 Oct): within 2 hours → 10 minutes; later the same day → 1 hour; the next day or later → 2 hours. */
export const DEFAULT_AGENCY_TIMING: AgencyTiming = { soonMinutes: 10, todayMinutes: 60, laterMinutes: 120 };
export const STEP_LIMITS = { soonMinutes: 240, todayMinutes: 720, laterMinutes: 1440 } as const;

export type TimingBand = 'soon' | 'today' | 'later';
/** Which band a shift falls in: starts within 2 hours, later the same day (the site's date), or the next day or later. */
export function timingBand(startsAt: Date, now: Date, zone: string): TimingBand {
  if (startsAt.getTime() - now.getTime() <= 2 * 3600_000) return 'soon';
  return localDate(startsAt, zone) === localDate(now, zone) ? 'today' : 'later';
}
export const BAND_WORDS: Record<TimingBand, string> = {
  soon: 'starts within 2 hours', today: 'starts later today', later: 'starts tomorrow or later',
};

/** Minutes between one agency and the next for this shift, from the business's timing (David's defaults if unset). */
export function escalationMinutes(startsAt: Date, now: Date, zone: string, timing: AgencyTiming = DEFAULT_AGENCY_TIMING): number {
  const band = timingBand(startsAt, now, zone);
  return band === 'soon' ? timing.soonMinutes : band === 'today' ? timing.todayMinutes : timing.laterMinutes;
}

/** "10 minutes", "1 hour", "1 hour 30 minutes", "2 hours". */
export function minutesWords(mins: number): string {
  if (mins === 1440) return '1 day';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || '0 minutes';
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
/**
 * Why a shift can't go to agencies now, or null. `activeAgencies` counts active links that fill the shift's site;
 * `activeAnywhere` (all active links) tells "none for this site" apart from "none at all".
 */
export function agencyFillProblem(shift: FillShift, activeAgencies: number, hasOpenRequest: boolean, now: Date, w: Words = DEFAULT_WORDS, activeAnywhere = activeAgencies): string | null {
  const shiftWord = w.lower(T.shift);
  if (shift.status === 'cancelled') return `This ${shiftWord} has been cancelled`;
  if (shift.equipmentOnly) return `Nobody works an equipment-only ${shiftWord}, so it can't go to agencies`;
  if (shift.status !== 'open') return `Someone is already on this ${shiftWord}`;
  if (shift.startsAt.getTime() <= now.getTime()) return `This ${shiftWord} has already started`;
  if (hasOpenRequest) return `This ${shiftWord} has already been sent to agencies`;
  if (activeAgencies === 0 && activeAnywhere > 0) return `None of your agencies fills ${w.lower(T.shift, true)} at this ${w.lower(T.site)}. Choose which ${w.lower(T.site, true)} each agency fills in Settings → Agencies.`;
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
  /** F or M when the employer asked for a gender (migration 0049); a warning for the agency's people, never a block. */
  genderRequested?: 'F' | 'M' | null;
};

/** "A female worker requested" for the request's gender, or null. */
export function genderRequestWords(g: 'F' | 'M' | null | undefined): string | null {
  return g === 'F' ? 'A female worker requested' : g === 'M' ? 'A male worker requested' : null;
}

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
    ...(genderRequestWords(s.genderRequested) ? [genderRequestWords(s.genderRequested)!] : []),
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

export type Placement = 'waiting' | 'booked' | 'declined' | 'removed' | 'pulled_out' | 'cancelled';
/** What an agency is told about: a change of placement, or the employer changing the shift itself (migration 0056). */
export type Notice = Exclude<Placement, 'waiting'> | 'changed';

/** How a placement reads, from either side ("Booked", "Waiting for Bayside Hospital to approve"). */
export function placementWords(p: Placement, employerName?: string): string {
  switch (p) {
    case 'booked': return 'Booked';
    case 'waiting': return employerName ? `Waiting for ${employerName} to approve` : 'Waiting for approval';
    case 'declined': return 'Declined by the employer';
    case 'removed': return 'Taken off the shift by the employer';
    case 'pulled_out': return 'Pulled out';
    case 'cancelled': return 'The shift was cancelled';
  }
}

/**
 * The email to the employer's owners and admins when an agency puts someone forward. Names the person (that is the
 * point of it) and the shift; nothing else about them. Uses the employer's own words.
 */
export function putForwardEmail(p: {
  agencyName: string; personName: string; role: string; siteName: string; areaName: string | null; startsAt: Date; endsAt: Date;
  siteTimezone: string; booked: boolean; shiftId: string; weekStart: string;
}, appUrl: string | null, w: Words = DEFAULT_WORDS) {
  const where = [p.areaName, p.siteName].filter(Boolean).join(', ');
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/roster?week=${p.weekStart}&shift=${p.shiftId}#shift-panel` : null;
  const lines = [
    `${p.agencyName} has put forward ${p.personName} for your ${w.lower(T.shift)}:`,
    '',
    `${p.role} at ${where}`,
    localWhen(p),
    '',
    p.booked
      ? `${p.personName} is booked on it. ${p.agencyName} has checked them against your requirements.`
      : `${p.personName} is waiting for your approval. ${p.agencyName} has checked them against your requirements. Approve or decline on the roster.`,
    link ? `Open it in CROP: ${link}` : `Open it on the roster in CROP.`,
  ];
  return {
    subject: p.booked ? `${p.agencyName} booked ${p.personName}: ${p.role} on ${localDay(p.startsAt, p.siteTimezone)}`
      : `Approve ${p.personName} from ${p.agencyName}? ${p.role} on ${localDay(p.startsAt, p.siteTimezone)}`,
    body: lines.join('\n'),
  };
}

/**
 * The email to the agency's owners and admins when the employer approves, declines or takes off the person it put
 * forward, records them as pulled out, or cancels the shift. Names the agency's own person and the shift only.
 * Uses the agency's own words.
 */
export function placementChangedEmail(p: {
  employerName: string; personName: string; role: string; siteName: string; areaName: string | null; startsAt: Date; endsAt: Date;
  siteTimezone: string; placement: Notice;
}, appUrl: string | null, w: Words = DEFAULT_WORDS) {
  const where = [p.areaName, p.siteName].filter(Boolean).join(', ');
  const shift = w.lower(T.shift);
  const day = localDay(p.startsAt, p.siteTimezone);
  const what: Record<typeof p.placement, { subject: string; line: string }> = {
    booked: { subject: `${p.employerName} approved ${p.personName}`, line: `${p.employerName} has approved ${p.personName}. They are booked on the ${shift}.` },
    declined: { subject: `${p.employerName} declined ${p.personName}`, line: `${p.employerName} has declined ${p.personName} for this ${shift}. They are free at that time again.` },
    removed: { subject: `${p.employerName} took ${p.personName} off ${w.a(T.shift)}`, line: `${p.employerName} has taken ${p.personName} off this ${shift}. They are free at that time again.` },
    pulled_out: { subject: `${p.employerName} recorded ${p.personName} as pulled out`, line: `${p.employerName} has recorded that ${p.personName} pulled out of this ${shift}. They are free at that time again.` },
    cancelled: { subject: `${p.employerName} cancelled ${w.a(T.shift)} for ${p.personName}`, line: `${p.employerName} has cancelled this ${shift}, so ${p.personName} isn't needed. They are free at that time again.` },
    changed: { subject: `${p.employerName} changed ${p.personName}'s ${shift}`, line: `${p.employerName} has changed this ${shift}. The details are now as below: please check ${p.personName} can still work it, and pull them out in CROP if they can't.` },
  };
  const lines = [
    what[p.placement].line,
    '',
    `${p.role} at ${where}`,
    localWhen(p),
    '',
    appUrl ? `See it in CROP: ${appUrl.replace(/\/$/, '')}/allocations` : 'See it in CROP under Allocations.',
  ];
  return { subject: `${what[p.placement].subject}: ${p.role} on ${day}`, body: lines.join('\n') };
}

/**
 * The email to the employer's owners and admins when an agency takes back the person it put forward. The shift is
 * open again. Uses the employer's own words.
 */
export function pulledOutEmail(p: {
  agencyName: string; personName: string; role: string; siteName: string; areaName: string | null; startsAt: Date; endsAt: Date;
  siteTimezone: string; reason: string | null; shiftId: string; weekStart: string;
}, appUrl: string | null, w: Words = DEFAULT_WORDS) {
  const where = [p.areaName, p.siteName].filter(Boolean).join(', ');
  const shift = w.lower(T.shift);
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/roster?week=${p.weekStart}&shift=${p.shiftId}#shift-panel` : null;
  const lines = [
    `${p.agencyName} has pulled ${p.personName} out of your ${shift}:`,
    '',
    `${p.role} at ${where}`,
    localWhen(p),
    ...(p.reason ? [`Reason from ${p.agencyName}: ${p.reason}`] : []),
    '',
    `The ${shift} is open again. You can put someone on it or send it to your agencies again.`,
    link ? `Open it in CROP: ${link}` : 'Open it on the roster in CROP.',
  ];
  return { subject: `${p.agencyName} pulled ${p.personName} out: ${p.role} on ${localDay(p.startsAt, p.siteTimezone)}`, body: lines.join('\n') };
}

/** The shift as the agency's person sees it: "Nurse at Ward 3, Bayside Campus (Bayside Hospital), Tue 3 Nov, 7:00am to 3:30pm". */
export function agencyShiftLine(s: { employerName: string; role: string; siteName: string; areaName: string | null; startsAt: Date; endsAt: Date; siteTimezone: string }) {
  const where = [s.areaName, s.siteName].filter(Boolean).join(', ');
  return `${s.role} at ${where} (${s.employerName}), ${localWhen(s)}`;
}

type AgencyOfferShift = Parameters<typeof agencyShiftLine>[0];

/**
 * The offer to one of the agency's own people (email and text), from the agency, in the agency's words. The first to
 * accept goes. First name and the shift only.
 */
export function agencyOfferMessage(firstName: string, agency: string, s: AgencyOfferShift, expiresLabel: string | null, link: string | null, w: Words = DEFAULT_WORDS) {
  const what = agencyShiftLine(s);
  const aShift = w.a(T.shift);
  const until = expiresLabel ? ` The offer is open until ${expiresLabel}.` : '';
  const subject = `${w.one(T.shift)} available: ${s.role} on ${localDay(s.startsAt, s.siteTimezone)}`;
  if (link) {
    return {
      subject,
      email: `Hi ${firstName},\n\n${agency} has ${aShift} for you:\n\n${what}\n\nAccept or decline here: ${link}\n\nThe first person to accept goes.${until} This link is just for you, so please don't forward it.\n\nThanks,\n${agency}`,
      sms: `Hi ${firstName}, ${agency} has ${aShift} for you: ${what}. Accept or decline: ${link} (first to accept goes).${until}`,
    };
  }
  return {
    subject,
    email: `Hi ${firstName},\n\n${agency} has ${aShift} for you:\n\n${what}\n\nContact ${agency} if you'd like it. The first person to accept goes.${until}\n\nThanks,\n${agency}`,
    sms: `Hi ${firstName}, ${agency} has ${aShift} for you: ${what}. Contact ${agency} if you'd like it; the first to accept goes.${until}`,
  };
}

/** To the person who accepted: booked, or waiting for the employer's approval. */
export function agencyAcceptedMessage(firstName: string, agency: string, s: AgencyOfferShift, booked: boolean, w: Words = DEFAULT_WORDS) {
  const what = agencyShiftLine(s);
  const shift = w.lower(T.shift);
  const state = booked ? `You're booked.` : `${s.employerName} approves people from ${agency} first, so you're not booked yet. ${agency} will confirm with you.`;
  return {
    subject: booked ? `Booked: ${s.role} on ${localDay(s.startsAt, s.siteTimezone)}` : `Waiting for approval: ${s.role} on ${localDay(s.startsAt, s.siteTimezone)}`,
    email: `Hi ${firstName},\n\nThanks for taking this ${shift}:\n\n${what}\n\n${state}\n\nThanks,\n${agency}`,
    sms: `Hi ${firstName}, thanks for taking the ${shift}: ${what}. ${state}`,
  };
}

/** To the others who were offered it, once someone has it (email only). */
export function agencyFilledMessage(firstName: string, agency: string, s: AgencyOfferShift, w: Words = DEFAULT_WORDS) {
  const shift = w.lower(T.shift);
  return {
    subject: `${w.one(T.shift)} filled: ${s.role} on ${localDay(s.startsAt, s.siteTimezone)}`,
    email: `Hi ${firstName},\n\nThe ${shift} we offered you has been filled:\n\n${agencyShiftLine(s)}\n\nThanks for your time.\n\n${agency}`,
  };
}

/** Whether a link fills a site: no list means every site. */
export function linkCoversSite(facilityIds: string[] | null, facilityId: string): boolean {
  return facilityIds === null || facilityIds.includes(facilityId);
}

/**
 * The sites an agency may fill, from the request body (`facilityIds`: null or [] of ids = every site).
 * Returns the list to store (null = every site) or a problem. `known` are the business's site ids.
 */
export function sitesChoice(value: unknown, known: string[], w: Words = DEFAULT_WORDS): { facilityIds: string[] | null } | { problem: string } {
  if (value === null || value === undefined) return { facilityIds: null };
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) return { problem: `Choose the ${w.lower(T.site, true)} from the list` };
  const ids = [...new Set(value as string[])];
  if (ids.some(id => !known.includes(id))) return { problem: `One of those ${w.lower(T.site, true)} isn't yours` };
  if (ids.length === 0 || known.every(k => ids.includes(k))) return { facilityIds: null };
  return { facilityIds: ids.sort() };
}

/** "Every site", "Riverside", "Riverside and Docklands", "3 sites: A, B and C". */
export function sitesWords(names: string[] | null, w: Words = DEFAULT_WORDS): string {
  if (names === null) return `Every ${w.lower(T.site)}`;
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const list = sorted.length <= 1 ? (sorted[0] ?? '') : `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
  return sorted.length > 2 ? `${w.count(sorted.length, T.site)}: ${list}` : list;
}

/**
 * The agency's view of a link's sites (from `app_agency_link_sites`): "Every site (A and B)" when the employer
 * hasn't limited it (new sites included), else the sites by name; "No sites yet" when the employer has none.
 */
export function agencySitesWords(names: string[], everySite: boolean, w: Words = DEFAULT_WORDS): string {
  if (names.length === 0) return `No ${w.lower(T.site, true)} yet`;
  if (!everySite) return sitesWords(names, w);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const list = sorted.length <= 1 ? sorted[0] : `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
  return `Every ${w.lower(T.site)} (${list})`;
}
