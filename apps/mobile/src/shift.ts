/**
 * Pure helpers for one shift in manager mode (backlog item 9a: filling shifts from the phone; tested in
 * test/shift.spec.ts). The screen calls the office endpoints as they are; these only shape what it shows.
 */
import { dayLabel } from './format';

export interface ShiftDetail {
  id: string; facilityId: string; facilityName: string; areaName: string | null; role: string;
  status: 'open' | 'assigned' | 'booked' | 'cancelled' | string; equipmentOnly: boolean;
  localDate: string; localStart: string; localEnd: string; hours: number;
  workerId: string | null; workerName: string | null; assignmentStatus: 'assigned' | 'confirmed' | null; agencyName: string | null;
  offersPending: number; pulledOutName: string | null; coveringWorkerId?: string | null; coveringName: string | null; cancelledReason: string | null; notes: string | null;
}

export interface Reason { code: string; message: string }

export interface Candidate {
  workerId: string; name: string; employmentType: string | null; weekHours: number; available: boolean;
  eligible: boolean; blocks: Reason[]; warnings: Reason[]; offer: { id: string; status: string } | null;
}

export interface Offer { id: string; workerId: string; workerName: string; status: string }

/** GET /shifts/:id/bank-fill?everyone=true */
export interface FillState { shift: ShiftDetail; candidates: Candidate[]; offers: Offer[] }

type Word = { lower: string };

/** Reasons as one run of sentences, without doubled full stops. */
export function sentences(list: (Reason | string)[]): string {
  return list.map(x => (typeof x === 'string' ? x : x.message).trim().replace(/\.+$/, '')).filter(Boolean).join('. ');
}

/** The stage the shift is in, in the roster's words, and how loud to show it. */
export function stageOf(s: ShiftDetail): { label: string; tone: 'urgent' | 'waiting' | 'booked' | 'plain' } {
  if (s.status === 'cancelled') return { label: s.cancelledReason ? `Cancelled: ${s.cancelledReason}` : 'Cancelled', tone: 'plain' };
  if (s.equipmentOnly) return { label: s.status === 'booked' ? 'Equipment booked' : 'No equipment on it yet', tone: s.status === 'booked' ? 'booked' : 'urgent' };
  if (s.workerName && s.assignmentStatus === 'confirmed') return { label: `Booked: ${s.workerName}`, tone: 'booked' };
  if (s.workerName && s.agencyName) return { label: `${s.workerName} from ${s.agencyName}, waiting for you to approve`, tone: 'waiting' };
  if (s.workerName) return { label: `${s.workerName}, waiting for them to confirm`, tone: 'waiting' };
  const out = s.pulledOutName ? ` (${s.pulledOutName} pulled out)` : '';
  if (s.offersPending > 0) return { label: `Offered to ${s.offersPending} ${s.offersPending === 1 ? 'person' : 'people'}, nobody yet${out}`, tone: 'waiting' };
  return { label: `Nobody on it${out}`, tone: 'urgent' };
}

/** "Mon 2 Nov 07:00–15:30 (8 h)" */
export function shiftWhen(s: Pick<ShiftDetail, 'localDate' | 'localStart' | 'localEnd' | 'hours'>, today?: string): string {
  return `${dayLabel(s.localDate, today)} ${s.localStart}–${s.localEnd} (${hoursText(s.hours)})`;
}

export function hoursText(h: number): string {
  return `${Number.isInteger(h) ? h : Math.round(h * 100) / 100} h`;
}

const TYPE_LABEL: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual', bank: 'Bank' };

/** "Casual · 12 h this week" */
export function candidateMeta(c: Pick<Candidate, 'employmentType' | 'weekHours'>): string {
  const type = c.employmentType ? TYPE_LABEL[c.employmentType] ?? null : null;
  const hours = `${hoursText(c.weekHours)} this week`;
  return type ? `${type} · ${hours}` : hours;
}

/** One line on whether they can work it: "Ready", the warnings, or why not. */
export function candidateState(c: Pick<Candidate, 'eligible' | 'blocks' | 'warnings'>): { label: string; tone: 'ready' | 'warning' | 'blocked' } {
  if (!c.eligible) return { label: sentences(c.blocks), tone: 'blocked' };
  if (c.warnings.length) return { label: sentences(c.warnings), tone: 'warning' };
  return { label: 'Ready', tone: 'ready' };
}

/** What to ask before putting someone on: plain for ready people, the warnings spelt out otherwise. */
export function assignQuestion(c: Pick<Candidate, 'name' | 'warnings'>, word: Word): { title: string; message?: string } {
  const title = `Put ${c.name} on this ${word.lower}?`;
  return c.warnings.length ? { title, message: `${sentences(c.warnings)}.` } : { title };
}

/** After putting someone on: they still have to confirm, and any warnings the server gave back. */
export function assignedMessage(name: string, warnings: Reason[] | string[] | undefined): string {
  const w = sentences(warnings ?? []);
  const base = `${name} is on it, waiting for them to confirm.`;
  return w ? `${base} Note: ${w}.` : base;
}

const BANK_TYPES = ['bank', 'casual'];

/** Bank and casual staff who could be offered the shift now (ready or warnings only, no offer waiting). */
export function offerable(list: Candidate[]): Candidate[] {
  return list.filter(c => c.eligible && BANK_TYPES.includes(c.employmentType ?? '') && c.offer?.status !== 'pending');
}

/** Everyone else who could be put on directly (not offered): all eligible people, ready first as the server ranks them. */
export function assignable(list: Candidate[]): Candidate[] {
  return list.filter(c => c.eligible);
}

export function offeredMessage(r: { offered: number; alreadyOffered: number; messages: number }): string {
  const parts: string[] = [];
  if (r.offered) parts.push(`Offered to ${r.offered} ${r.offered === 1 ? 'person' : 'people'}.`);
  if (r.alreadyOffered) parts.push(`${r.alreadyOffered} already had an offer waiting.`);
  parts.push(r.messages ? 'They have been sent a message; the first to accept gets it.' : 'No messages were sent (no email or mobile on file).');
  return parts.join(' ');
}

/** Offers still waiting for a reply. */
export function pendingOffers(offers: Offer[]): Offer[] {
  return offers.filter(o => o.status === 'pending');
}

export type Action = 'assign' | 'confirm' | 'remove' | 'pulled_out' | 'cancel' | 'offer';

/** What can be done to the shift as it is now. Offers wait for the after-publishing rule like any change. */
export function actionsFor(s: ShiftDetail, refused: boolean): Action[] {
  if (s.status === 'cancelled') return [];
  const out: Action[] = [];
  if (!s.equipmentOnly) {
    if (s.status === 'open') out.push('assign');
    if (s.status === 'open' && !refused) out.push('offer');
    if (s.workerId && s.assignmentStatus === 'assigned') out.push('confirm');
    if (s.workerId) out.push('remove', 'pulled_out');
  }
  out.push('cancel');
  return out;
}

/**
 * The change request kind for an action when the after-publishing rule stops this person making it themselves
 * (POST /shifts/:id/change-requests); offering has none, since it isn't allowed while changes are refused.
 */
export function requestKind(a: Action): 'assign' | 'confirm' | 'remove' | 'pulled_out' | 'cancel' | null {
  return a === 'offer' ? null : a;
}

/** The label for confirming: approving an agency's person reads differently from booking your own. */
export function confirmLabel(s: Pick<ShiftDetail, 'agencyName' | 'workerName'>): string {
  return s.agencyName ? `Approve ${s.workerName ?? 'them'}` : 'Mark as confirmed';
}

/** The Monday (YYYY-MM-DD) of the week a local date falls in, for GET /roster/weeks. */
export function mondayOf(localDate: string): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** tel: and sms: links for a phone number as stored (spaces and brackets dropped; a leading + kept). */
export function phoneLinks(phone: string | null | undefined): { call: string; text: string } | null {
  const p = (phone ?? '').trim();
  const digits = p.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  if (digits.replace('+', '').length < 6) return null;
  return { call: `tel:${digits}`, text: `sms:${digits}` };
}

/** The message after a change request is sent instead of a change. */
export const REQUEST_SENT = 'Sent to the owners and admins to approve. You will see it under Requests until they decide.';

export type CoveringChoice = { id: string; label: string; away: boolean };

/** Leave rows from GET /roster (requested or approved; the kind is never sent). */
export interface LeaveLine { workerId: string; status: 'requested' | 'approved'; startsOn: string; endsOn: string }

/**
 * Who the shift could be covering (Steve's "T" line), as on the web's shift panel: people on leave that day first
 * (approved, then requested, labelled "on leave" / "leave requested", never the kind), then everyone else by name.
 * The person working the shift is left out; whoever it covers now stays in the list even if they've left the roster.
 */
export function coveringChoices(
  people: { id: string; name: string }[], leave: LeaveLine[], localDate: string,
  current: { id: string | null; name: string | null }, workingId: string | null,
): CoveringChoice[] {
  const away = new Map<string, 'approved' | 'requested'>();
  for (const l of leave) {
    if (l.startsOn > localDate || l.endsOn < localDate) continue;
    if (l.status === 'approved' || !away.has(l.workerId)) away.set(l.workerId, l.status);
  }
  const list = people.filter(p => p.id !== workingId);
  if (current.id && current.name && !list.some(p => p.id === current.id)) list.push({ id: current.id, name: current.name });
  const rank = (id: string) => (away.get(id) === 'approved' ? 0 : away.get(id) === 'requested' ? 1 : 2);
  return list
    .map(p => ({ p, r: rank(p.id) }))
    .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name))
    .map(({ p, r }) => ({ id: p.id, label: r === 0 ? `${p.name} · on leave` : r === 1 ? `${p.name} · leave requested` : p.name, away: r < 2 }));
}

/**
 * Whether the covering line can be changed from the phone: not on cancelled or equipment-only shifts, and not while the
 * after-publishing rule refuses this person's changes (there is no change request for it; they ask on the web).
 */
export function canSetCovering(s: Pick<ShiftDetail, 'status' | 'equipmentOnly'>, refused: boolean): boolean {
  return s.status !== 'cancelled' && !s.equipmentOnly && !refused;
}

/** The message after saving the covering line. */
export function coveringMessage(name: string | null): string {
  return name ? `Shown as "Covering ${name}". The reason they're away is never shown.` : 'It no longer says who it covers.';
}
