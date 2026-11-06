/**
 * Phone alerts for the office (backlog item 9a; David, 29 Oct: "push notifications for what can't wait (someone
 * pulls out, a shift starting soon with nobody on it or unconfirmed, a request waiting), with quiet hours").
 * Pure rules and wording; the database side is `manager-alerts-data.ts`.
 *
 * Two kinds, each switched on or off by the person:
 * - `decisions`: something waiting for an owner's or admin's yes or no (leave asked for in the app, a roster
 *   change request). Held through quiet hours and sent when they end.
 * - `at_risk`: a shift at one of their sites starting within two hours with nobody on it or not confirmed, and an
 *   agency pulling its person out. Never held: an alert after the shift started is no use, so during quiet hours
 *   nothing goes and the next check after quiet hours sends it if it still matters (pull-outs are held like decisions).
 * Wording never carries health information, leave kinds, notes or document numbers.
 */
import { localDateOf, localTimeOf, localToUtc, addDays } from '../demo/demo-time.js';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

export type AlertKind = 'decisions' | 'at_risk';

export interface AlertSettings {
  decisions: boolean;
  atRisk: boolean;
  /** Local HH:MM in the business's time zone; both null = no quiet hours. */
  quietFrom: string | null;
  quietUntil: string | null;
}

/** CROP's defaults when the person hasn't chosen (no row in member_alerts). */
export const ALERT_DEFAULTS: AlertSettings = { decisions: true, atRisk: true, quietFrom: '22:00', quietUntil: '06:00' };

/** Shifts starting within this many minutes with nobody on them, or not confirmed, are at risk. */
export const AT_RISK_MINUTES = 120;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Plain-English problem with a quiet-hours choice, or null when it's fine. */
export function quietProblem(from: string | null, until: string | null): string | null {
  if (from === null && until === null) return null;
  if (from === null || until === null) return 'Choose both when quiet hours start and when they end, or neither';
  if (!HHMM.test(from) || !HHMM.test(until)) return 'Write quiet hours as times like 22:00 and 06:00';
  if (from === until) return 'Quiet hours must start and end at different times';
  return null;
}

/** Whether a local HH:MM falls in quiet hours (which may run past midnight). */
export function inQuiet(local: string, from: string | null, until: string | null): boolean {
  if (!from || !until) return false;
  return from < until ? local >= from && local < until : local >= from || local < until;
}

/** When the person's quiet hours end, if `now` is inside them (the business's time zone); otherwise null. */
export function quietEndsAt(now: Date, zone: string, s: Pick<AlertSettings, 'quietFrom' | 'quietUntil'>): Date | null {
  const local = localTimeOf(now, zone);
  if (!inQuiet(local, s.quietFrom, s.quietUntil)) return null;
  const today = localDateOf(now, zone);
  const day = local < s.quietUntil! ? today : addDays(today, 1);
  return localToUtc(day, s.quietUntil!, zone);
}

/** What to do with one alert for one person: send now, hold until quiet hours end, or not send. */
export type AlertPlan = { send: true; notBefore: Date | null } | { send: false };

export function planAlert(kind: AlertKind, s: AlertSettings, now: Date, zone: string, holdThroughQuiet: boolean): AlertPlan {
  if (kind === 'decisions' ? !s.decisions : !s.atRisk) return { send: false };
  const end = quietEndsAt(now, zone, s);
  if (!end) return { send: true, notBefore: null };
  return holdThroughQuiet ? { send: true, notBefore: end } : { send: false };
}

/** Who should hear about a site's alerts: owners and admins always; allocators unless limited to other sites; supervisors only for their sites. */
export function seesSite(m: { role: string; sites: string[] }, facilityId: string | null): boolean {
  if (m.role === 'owner' || m.role === 'admin') return true;
  if (m.role === 'allocator' && m.sites.length === 0) return true;
  if (m.role !== 'allocator' && m.role !== 'supervisor') return false;
  return facilityId !== null && m.sites.includes(facilityId);
}

/** "45 min", "1 h", "1 h 30 min". */
export function soonWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export interface AtRiskShift {
  role: string;
  facilityName: string;
  areaName: string | null;
  localStart: string;
  localEnd: string;
  workerName: string | null;
  agencyName: string | null;
  assignmentStatus: 'assigned' | 'confirmed' | null;
}

export type AtRiskKind = 'open' | 'unconfirmed' | 'to_approve';

/** Why a shift starting soon needs someone, or null when it's fine (someone confirmed on it). */
export function atRiskKind(s: Pick<AtRiskShift, 'assignmentStatus' | 'agencyName'>): AtRiskKind | null {
  if (!s.assignmentStatus) return 'open';
  if (s.assignmentStatus === 'assigned') return s.agencyName ? 'to_approve' : 'unconfirmed';
  return null;
}

export function atRiskPush(kind: AtRiskKind, s: AtRiskShift, minutes: number, w: Words = DEFAULT_WORDS) {
  const when = `${s.localStart}–${s.localEnd}`;
  const where = `${s.facilityName}${s.areaName ? `, ${s.areaName}` : ''}`;
  const soon = soonWords(minutes);
  if (kind === 'open') {
    return { title: `Unfilled: ${s.role} at ${s.facilityName} in ${soon}`,
      body: `${w.one(T.shift)} ${when} at ${where} has nobody on it. Open CROP to fill it.` };
  }
  if (kind === 'to_approve') {
    return { title: `Approve ${s.workerName} from ${s.agencyName}?`,
      body: `${s.role} ${when} at ${where} starts in ${soon} and is waiting for your approval. Open CROP to approve or decline.` };
  }
  return { title: `Not confirmed: ${s.workerName}, ${s.role} in ${soon}`,
    body: `${s.workerName} hasn't confirmed ${w.lower(T.shift)} ${when} at ${where}. Open CROP to follow up.` };
}

/** An agency took its person off a shift (they emailed too). */
export function pulledOutPush(p: { agencyName: string; personName: string; role: string; siteName: string; when: string }, w: Words = DEFAULT_WORDS) {
  return { title: `${p.agencyName} pulled ${p.personName} out`,
    body: `${p.role}, ${p.when} at ${p.siteName}. The ${w.lower(T.shift)} is open again. Open CROP to fill it.` };
}

function day(iso: string) {
  return new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`)).replace(',', '');
}

/** Leave asked for in the app, for the owners and admins who decide it. Never the kind or the note. */
export function leavePush(p: { name: string; startsOn: string; endsOn: string; shiftsDuring: number }, w: Words = DEFAULT_WORDS) {
  const dates = p.startsOn === p.endsOn ? day(p.startsOn) : `${day(p.startsOn)} to ${day(p.endsOn)}`;
  const during = p.shiftsDuring ? ` ${w.count(p.shiftsDuring, T.shift)} rostered then.` : '';
  return { title: `Leave to approve: ${p.name}`, body: `${dates}.${during} Open CROP to approve or decline.` };
}

/** A change to a published roster waiting for approval. */
export function changeRequestPush(p: { who: string | null; summary: string; facilityName: string; shiftLine: string }, w: Words = DEFAULT_WORDS) {
  return { title: `${w.one(T.roster)} change to approve at ${p.facilityName}`,
    body: `${p.who ?? 'Someone in the office'} asked: ${p.summary} (${p.shiftLine}). Open CROP to approve or decline.` };
}

/** The settings screen's line for the quiet hours. */
export function quietLine(s: Pick<AlertSettings, 'quietFrom' | 'quietUntil'>): string {
  return s.quietFrom && s.quietUntil ? `Quiet from ${s.quietFrom} to ${s.quietUntil}` : 'No quiet hours';
}
