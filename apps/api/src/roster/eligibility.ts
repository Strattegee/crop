/**
 * Who may work a shift (backlog item 3). Pure functions: no database access.
 *
 * Hard blocks (assigning is refused):
 * - the person doesn't hold the shift's role;
 * - a hard credential rule or right to work isn't met on the shift date (compliance.ts with onDate, CRD-8);
 * - they're already rostered at an overlapping time;
 * - the shift would take them over their visa's hours in a fortnight (any 14 days starting on a Monday).
 * Warnings (shown, not blocking): warning-level credential rules, credentials expiring soon,
 * and less rest between shifts than the business's minimum.
 */
import { addDays, credentialStatus, type ComplianceIssue, type CredentialFacts } from '../workforce/compliance.js';

export interface ShiftFacts {
  id?: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  /** Site-local date the shift starts on (YYYY-MM-DD). */
  localDate: string;
  hours: number;
}

export interface OtherShift extends ShiftFacts {
  facilityName: string;
  /** Site-local start and end, for messages, e.g. "Mon 02 Nov 07:00–15:30". */
  label: string;
}

export interface EligibilityInput {
  name: string;
  roles: string[];
  /** Compliance on the shift date (only the issues are used). */
  issues: ComplianceIssue[];
  /** The person's other current assignments near the shift. */
  others: OtherShift[];
  /** From a limited visa; null when not limited. */
  hoursPerFortnight: number | null;
  minRestHours: number;
  /** Equipment already on the shift that needs an operator holding a credential (backlog item 4). */
  operatorNeeds?: OperatorNeed[];
  /** The person's credentials, for operator needs. */
  credentials?: CredentialFacts[];
  /** The business's expiring window in days, for operator credentials. */
  windowDays?: number;
}

export interface OperatorNeed { equipmentName: string; credentialTypeId: string; typeName: string }

export type ReasonCode = 'role' | 'credential' | 'right_to_work' | 'double_booked' | 'visa_hours' | 'rest'
  | 'operator' | 'equipment_status' | 'equipment_check';
export interface Reason { code: ReasonCode; message: string }
export interface Eligibility { eligible: boolean; blocks: Reason[]; warnings: Reason[] }

const PROBLEM_TEXT: Record<ComplianceIssue['problem'], string> = {
  missing: 'is missing',
  rejected: 'was rejected',
  unverified: "isn't verified yet",
  expired: 'will have expired by the shift date',
  expiring: 'expires soon',
  no_work_rights: "doesn't have confirmed work rights (VEVO)",
};

/** Monday on or before a date (YYYY-MM-DD). */
export function mondayOf(date: string): string {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(date, -dow);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** e.g. "Mon 26 Oct". */
export const fmtDate = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
};
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The 14-day periods starting on a Monday that contain the date: one starting the Monday of its week,
 * one starting the Monday before.
 */
export function fortnightsContaining(date: string): Array<{ from: string; to: string }> {
  const m = mondayOf(date);
  return [addDays(m, -7), m].map(from => ({ from, to: addDays(from, 13) }));
}

export function shiftEligibility(shift: ShiftFacts, p: EligibilityInput): Eligibility {
  const blocks: Reason[] = [];
  const warnings: Reason[] = [];

  if (!p.roles.some(r => r.toLowerCase() === shift.role.toLowerCase())) {
    blocks.push({ code: 'role', message: `${p.name} doesn't have the role ${shift.role}` });
  }

  for (const i of p.issues) {
    const code: ReasonCode = i.credentialTypeId === 'right-to-work' ? 'right_to_work' : 'credential';
    const message = `${p.name}'s ${i.typeName} ${PROBLEM_TEXT[i.problem]}`;
    if (i.severity === 'hard' && i.problem !== 'expiring') blocks.push({ code, message });
    else warnings.push({ code, message });
  }

  const others = p.others.filter(o => o.id !== shift.id);
  const clash = others.find(o => o.startsAt < shift.endsAt && o.endsAt > shift.startsAt);
  if (clash) blocks.push({ code: 'double_booked', message: `${p.name} is already rostered ${clash.label} at ${clash.facilityName}` });

  for (const need of p.operatorNeeds ?? []) {
    const r = operatorReason(p.name, p.credentials ?? [], need, shift.localDate, p.windowDays ?? 30);
    if (r) (r.hard ? blocks : warnings).push(r.reason);
  }

  if (p.hoursPerFortnight !== null) {
    for (const f of fortnightsContaining(shift.localDate)) {
      const total = shift.hours + others.filter(o => o.localDate >= f.from && o.localDate <= f.to).reduce((s, o) => s + o.hours, 0);
      if (total > p.hoursPerFortnight) {
        blocks.push({
          code: 'visa_hours',
          message: `${p.name}'s visa allows ${p.hoursPerFortnight} hours a fortnight; this shift would make ${round(total)} hours in the fortnight from ${fmtDate(f.from)}`,
        });
        break;
      }
    }
  }

  if (p.minRestHours > 0 && !clash) {
    const restMs = p.minRestHours * 3_600_000;
    const tooClose = others.find(o =>
      (o.endsAt <= shift.startsAt && shift.startsAt.getTime() - o.endsAt.getTime() < restMs) ||
      (o.startsAt >= shift.endsAt && o.startsAt.getTime() - shift.endsAt.getTime() < restMs));
    if (tooClose) {
      const gap = tooClose.endsAt <= shift.startsAt
        ? shift.startsAt.getTime() - tooClose.endsAt.getTime()
        : tooClose.startsAt.getTime() - shift.endsAt.getTime();
      warnings.push({
        code: 'rest',
        message: `${p.name} would have ${round(gap / 3_600_000)} hours' rest between this shift and ${tooClose.label} (minimum ${p.minRestHours})`,
      });
    }
  }

  return { eligible: blocks.length === 0, blocks, warnings };
}

/**
 * Whether a person can operate a piece of equipment on a date: they need a verified credential of the
 * operator type that hasn't expired by then. Expiring soon is a warning.
 */
export function operatorReason(
  personName: string, credentials: CredentialFacts[], need: OperatorNeed, onDate: string, windowDays: number,
): { hard: boolean; reason: Reason } | null {
  const held = credentials.filter(c => c.credentialTypeId === need.credentialTypeId && c.verification === 'verified');
  const statuses = held.map(c => credentialStatus(c.expiryDate, onDate, windowDays));
  if (statuses.includes('valid')) return null;
  if (statuses.includes('expiring')) {
    return { hard: false, reason: { code: 'operator', message: `${personName}'s ${need.typeName} expires soon (needed to operate ${need.equipmentName})` } };
  }
  return { hard: true, reason: { code: 'operator', message: `${personName} doesn't hold a current, verified ${need.typeName}, needed to operate ${need.equipmentName}` } };
}
