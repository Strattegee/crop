/**
 * Whether a piece of equipment may be booked to a shift (backlog item 4). Pure functions: no database access.
 *
 * Hard blocks (booking is refused):
 * - the equipment is out of service or retired;
 * - one of its dates (registration, service, inspection…) will be overdue on the shift's local date;
 * - it is already booked at an overlapping time;
 * - the person on the shift doesn't hold the operator credential its type needs (verified, current on the date).
 * Warnings: a date due soon (the business's expiring window), the operator's credential expiring soon,
 * or nobody on the shift yet when an operator is needed.
 */
import { credentialStatus, type CredentialFacts } from '../workforce/compliance.js';
import { fmtDate, operatorReason, type Eligibility, type OperatorNeed, type OtherShift, type Reason, type ShiftFacts } from './eligibility.js';

export type EquipmentStatus = 'active' | 'out_of_service' | 'retired';

export interface EquipmentCheckFacts {
  name: string;
  /** YYYY-MM-DD; the equipment may be used up to the end of this day. */
  dueOn: string;
}

export interface EquipmentInput {
  name: string;
  status: EquipmentStatus;
  checks: EquipmentCheckFacts[];
  /** The equipment's other current bookings near the shift. */
  others: OtherShift[];
  /** Operator credential its type needs, if any. */
  operator: { credentialTypeId: string; typeName: string } | null;
  /** The person on the shift, if any. */
  person: { name: string; credentials: CredentialFacts[] } | null;
  windowDays: number;
}

export type CheckState = 'ok' | 'due_soon' | 'overdue';

/** A date's state on a given day: overdue after its due date, due soon within the window. */
export function checkState(dueOn: string, onDate: string, windowDays: number): CheckState {
  const s = credentialStatus(dueOn, onDate, windowDays);
  return s === 'expired' ? 'overdue' : s === 'expiring' ? 'due_soon' : 'ok';
}

/** The worst state across the equipment's dates (no dates counts as ok). */
export function overallCheckState(checks: EquipmentCheckFacts[], onDate: string, windowDays: number): CheckState {
  const states = checks.map(c => checkState(c.dueOn, onDate, windowDays));
  return states.includes('overdue') ? 'overdue' : states.includes('due_soon') ? 'due_soon' : 'ok';
}

export function equipmentEligibility(shift: ShiftFacts, e: EquipmentInput): Eligibility {
  const blocks: Reason[] = [];
  const warnings: Reason[] = [];

  if (e.status === 'out_of_service') blocks.push({ code: 'equipment_status', message: `${e.name} is out of service` });
  if (e.status === 'retired') blocks.push({ code: 'equipment_status', message: `${e.name} is retired` });

  for (const c of [...e.checks].sort((a, b) => a.dueOn.localeCompare(b.dueOn))) {
    const state = checkState(c.dueOn, shift.localDate, e.windowDays);
    if (state === 'overdue') {
      blocks.push({ code: 'equipment_check', message: `${e.name}'s ${c.name} will be overdue by the shift date (due ${fmtDate(c.dueOn)})` });
    } else if (state === 'due_soon') {
      warnings.push({ code: 'equipment_check', message: `${e.name}'s ${c.name} is due soon (${fmtDate(c.dueOn)})` });
    }
  }

  const clash = e.others.filter(o => o.id !== shift.id).find(o => o.startsAt < shift.endsAt && o.endsAt > shift.startsAt);
  if (clash) blocks.push({ code: 'double_booked', message: `${e.name} is already booked ${clash.label} at ${clash.facilityName}` });

  if (e.operator) {
    const need: OperatorNeed = { equipmentName: e.name, ...e.operator };
    if (!e.person) {
      warnings.push({ code: 'operator', message: `${e.name} needs an operator holding a ${e.operator.typeName}; nobody is on this shift yet` });
    } else {
      const r = operatorReason(e.person.name, e.person.credentials, need, shift.localDate, e.windowDays);
      if (r) (r.hard ? blocks : warnings).push(r.reason);
    }
  }

  return { eligible: blocks.length === 0, blocks, warnings };
}
