import { showMobile } from './phone';

/**
 * Changes people asked for in the app to their own details (David, 3 Nov 2026, answer 5; API
 * `apps/api/src/workforce/detail-changes.ts`, migration 0087), as the office's lists show them. Pure.
 */
export type DetailChange = {
  id: string; workerId: string; workerName: string; field: 'name' | 'preferred_name' | 'email' | 'mobile' | 'gender' | 'address';
  action: 'add' | 'correct' | 'current' | 'remove' | null; label: string; what: string;
  askedLine: string; wasLine: string | null; nowLine: string | null; status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  createdAt: string; decidedAt: string | null; decidedByName: string | null; decidedNote: string | null; canDecide: boolean;
};

/** A mobile in the business's own way of writing it; other values as the API words them. */
const shown = (c: DetailChange, v: string | null, country: string | null | undefined) =>
  v && c.field === 'mobile' && v.startsWith('+') ? showMobile(v, country) : v;

/** "From 0412 345 678 to 0498 765 432", "Add: 5 Sample Lane, Carlton VIC 3053", "Take off the list: 5 Sample Lane…". */
export function changeLine(c: DetailChange, country?: string | null): string {
  const asked = shown(c, c.askedLine, country) ?? 'Not given';
  if (c.action === 'add') return `Add: ${asked}`;
  if (c.action === 'current') return `Make current: ${asked}`;
  if (c.action === 'remove') return `Take off the list: ${asked}`;
  return `From ${shown(c, c.wasLine, country) ?? 'Not given'} to ${asked}`;
}

/** When the office changed it since they asked: "It's 0411 111 111 now." */
export function nowLine(c: DetailChange, country?: string | null): string | null {
  return c.nowLine ? `Changed since they asked: it’s ${shown(c, c.nowLine, country)} now.` : null;
}

export const STATUS_WORD: Record<DetailChange['status'], string> = {
  pending: 'Waiting', approved: 'Approved', declined: 'Not approved', withdrawn: 'Withdrawn by them',
};
