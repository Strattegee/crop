/**
 * Requested changes to a published roster (migration 0025). Pure helpers: the kinds of change, and how a
 * request reads in the roster's list. Never mentions leave kinds or credential details.
 */
export type ChangeRequestKind = 'assign' | 'confirm' | 'remove' | 'pulled_out' | 'cancel' | 'other';
export const CHANGE_REQUEST_KINDS: ChangeRequestKind[] = ['assign', 'confirm', 'remove', 'pulled_out', 'cancel', 'other'];
export type ChangeRequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** What the request asks for, in plain words. */
export function requestSummary(r: { kind: ChangeRequestKind; workerName: string | null; currentName?: string | null; reason: string | null }): string {
  const current = r.currentName ?? 'the person on it';
  switch (r.kind) {
    case 'assign': return `Put ${r.workerName ?? 'someone'} on the shift`;
    case 'confirm': return `Confirm ${current} (they have agreed)`;
    case 'remove': return `Take ${current} off the shift`;
    case 'pulled_out': return `Record that ${current} pulled out`;
    case 'cancel': return r.reason ? `Cancel the shift: ${r.reason}` : 'Cancel the shift';
    case 'other': return r.reason ?? 'Another change';
  }
}

/**
 * Whether a request can be made for this shift as it is now; a plain reason when it can't.
 * `hasPerson`: someone is on it (assigned or confirmed).
 */
export function requestProblem(kind: ChangeRequestKind, shift: { status: string; equipmentOnly: boolean; hasPerson: boolean }): string | null {
  if (shift.status === 'cancelled') return 'This shift is cancelled';
  switch (kind) {
    case 'assign':
      if (shift.equipmentOnly) return 'This shift is for equipment only, so nobody can be put on it';
      return shift.hasPerson ? 'Someone is already on this shift. Ask for them to be taken off first.' : null;
    case 'confirm':
      return shift.status === 'assigned' ? null : 'There is nobody waiting to confirm on this shift';
    case 'remove':
    case 'pulled_out':
      return shift.hasPerson ? null : 'Nobody is on this shift';
    default:
      return null;
  }
}
