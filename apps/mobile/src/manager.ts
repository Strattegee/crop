/** Pure helpers for manager mode in the app (backlog item 9a; tested in test/manager.spec.ts). */
import { dayLabel, LEAVE_KIND_LABEL, leaveDates, type LeaveKind } from './format';

export type Role = 'owner' | 'admin' | 'allocator' | 'worker' | 'client';
export type Mode = 'manager' | 'worker';

/** Owners, admins and allocators run the roster; everyone else sees their own shifts. */
export function isManager(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'allocator';
}

/** Only owners and admins approve or decline leave and change requests (as on the web). */
export function canDecide(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** The view to open first for someone's role in a business. */
export function startMode(role: string | null | undefined): Mode {
  return isManager(role) ? 'manager' : 'worker';
}

export function roleOf(me: { memberships: { tenantSlug: string; role: string }[] }, slug: string | null): string | null {
  return me.memberships.find(m => m.tenantSlug === slug)?.role ?? null;
}

export type AttentionKind = 'person_blocked' | 'equipment_blocked' | 'cover_gap' | 'open' | 'unconfirmed';

export interface AttentionItem {
  shiftId: string;
  kind: AttentionKind;
  urgent: boolean;
  title: string;
  detail: string;
  startsIn: string;
  shift: { facilityName: string; areaName: string | null; role: string; localDate: string; localStart: string; localEnd: string; workerName: string | null };
}

export interface Attention {
  days: number;
  total: number;
  urgent: number;
  byKind: Record<AttentionKind, number>;
  truncated: boolean;
  items: AttentionItem[];
}

export const KIND_LABEL: Record<AttentionKind, string> = {
  person_blocked: "Can't work it",
  equipment_blocked: 'Equipment problem',
  cover_gap: 'Cover gap',
  open: 'Nobody on it',
  unconfirmed: 'Not confirmed',
};

/** "3 things in the next 7 days · 1 within a day", or the all-clear. */
export function attentionHeading(a: Pick<Attention, 'total' | 'urgent' | 'days'>): string {
  if (a.total === 0) return `Nothing needs attention in the next ${a.days} days.`;
  const things = `${a.total} ${a.total === 1 ? 'thing' : 'things'} in the next ${a.days} days`;
  return a.urgent > 0 ? `${things} · ${a.urgent} within a day` : things;
}

/** "Mon 2 Nov 07:00–15:30 · Kitchen hand · Kitchen · Main St" */
export function shiftWhere(s: AttentionItem['shift'], today?: string): string {
  const role = s.areaName ? `${s.role} · ${s.areaName}` : s.role;
  return `${dayLabel(s.localDate, today)} ${s.localStart}–${s.localEnd} · ${role} · ${s.facilityName}`;
}

export interface LeaveRequest {
  id: string; workerName: string; kind: string; startsOn: string; endsOn: string; days: number; status: string; note: string | null;
}

/** "Sam Lee · Annual · Mon 2 Nov – Wed 4 Nov (3 days)". The office decides on leave, so it sees the kind, as on the web's Leave page. */
export function leaveRequestLine(l: LeaveRequest): string {
  const kind = LEAVE_KIND_LABEL[l.kind as LeaveKind] ?? 'Other';
  return `${l.workerName} · ${kind} · ${leaveDates(l)}`;
}

/** After approving: whether any of their shifts now need someone else. */
export function approvedLeaveMessage(rostered: number, word: { lower: string; lowerMany: string }): string {
  if (rostered === 0) return 'Approved. They have nothing rostered in those days.';
  return `Approved. ${rostered} ${rostered === 1 ? `${word.lower} needs` : `${word.lowerMany} need`} someone else: they show in Needs attention.`;
}

export interface ChangeRequest {
  id: string; summary: string; requestedByName: string | null; reason: string | null; canDecide: boolean;
  facilityName: string; areaName: string | null; role: string; localDate: string; localStart: string; localEnd: string;
}

/** The shift a change request is about, in the same words as Needs attention. */
export function changeRequestShift(r: ChangeRequest, today?: string): string {
  return shiftWhere({ ...r, workerName: null }, today);
}

export interface Term { key: string; singular: string; plural: string }

/** The business's word for shifts from GET /terms, falling back to CROP's. */
export function shiftWord(terms: Term[] | null | undefined): { one: string; many: string; lower: string; lowerMany: string } {
  const t = terms?.find(x => x.key === 'shift');
  const one = t?.singular || 'Shift';
  const many = t?.plural || 'Shifts';
  return { one, many, lower: one.toLowerCase(), lowerMany: many.toLowerCase() };
}

/** The tab label for requests: "Requests (3)". */
export function requestsTab(leave: number, changes: number): string {
  const n = leave + changes;
  return n ? `Requests (${n})` : 'Requests';
}

/** Today's date (YYYY-MM-DD) in the business's time zone, never the phone's. */
export function todayIn(zone: string | null | undefined, now = new Date()): string | undefined {
  if (!zone) return undefined;
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (t: string) => p.find(x => x.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return undefined;
  }
}
