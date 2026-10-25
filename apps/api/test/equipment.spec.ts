import { describe, expect, it } from 'vitest';
import { shiftEligibility, type EligibilityInput, type OtherShift, type ShiftFacts } from '../src/roster/eligibility.js';
import { checkState, equipmentEligibility, overallCheckState, type EquipmentInput } from '../src/roster/equipment.js';
import type { CredentialFacts } from '../src/workforce/compliance.js';

const at = (s: string) => new Date(s);
const shift: ShiftFacts = { id: 's1', role: 'Operator', startsAt: at('2026-11-04T21:00:00Z'), endsAt: at('2026-11-05T05:00:00Z'), localDate: '2026-11-05', hours: 8 };
const other = (id: string, start: string, end: string): OtherShift =>
  ({ id, role: 'Operator', startsAt: at(start), endsAt: at(end), localDate: '2026-11-05', hours: 8, facilityName: 'North Yard', label: 'Thu 05 Nov 07:00–15:00' });
const licence = (over: Partial<CredentialFacts> = {}): CredentialFacts =>
  ({ id: 'c1', credentialTypeId: 'lf', expiryDate: '2028-01-01', verification: 'verified', ...over });
const base: EquipmentInput = {
  name: 'Forklift 2', status: 'active', checks: [], others: [], operator: null, person: null, windowDays: 30,
};
const withOperator: EquipmentInput = { ...base, operator: { credentialTypeId: 'lf', typeName: 'Forklift licence' } };

describe('equipment dates', () => {
  it('is overdue after the due date and due soon within the window', () => {
    expect(checkState('2026-11-05', '2026-11-05', 30)).toBe('due_soon'); // usable to the end of the due date
    expect(checkState('2026-11-04', '2026-11-05', 30)).toBe('overdue');
    expect(checkState('2027-06-01', '2026-11-05', 30)).toBe('ok');
    expect(overallCheckState([], '2026-11-05', 30)).toBe('ok');
    expect(overallCheckState([{ name: 'Service', dueOn: '2027-06-01' }, { name: 'Registration', dueOn: '2026-11-20' }], '2026-11-05', 30)).toBe('due_soon');
    expect(overallCheckState([{ name: 'Service', dueOn: '2026-11-01' }, { name: 'Registration', dueOn: '2026-11-20' }], '2026-11-05', 30)).toBe('overdue');
  });
});

describe('equipment eligibility', () => {
  it('is bookable when active, current and free', () => {
    expect(equipmentEligibility(shift, base)).toEqual({ eligible: true, blocks: [], warnings: [] });
  });

  it('blocks equipment out of service or retired', () => {
    expect(equipmentEligibility(shift, { ...base, status: 'out_of_service' }).blocks).toEqual([{ code: 'equipment_status', message: 'Forklift 2 is out of service' }]);
    expect(equipmentEligibility(shift, { ...base, status: 'retired' }).eligible).toBe(false);
  });

  it('blocks a date overdue on the shift date and warns when due soon', () => {
    const r = equipmentEligibility(shift, { ...base, checks: [{ name: 'Service', dueOn: '2026-11-20' }, { name: 'Registration', dueOn: '2026-11-04' }] });
    expect(r.blocks).toEqual([{ code: 'equipment_check', message: "Forklift 2's Registration will be overdue by the shift date (due Wed 4 Nov)" }]);
    expect(r.warnings).toEqual([{ code: 'equipment_check', message: "Forklift 2's Service is due soon (Fri 20 Nov)" }]);
  });

  it('blocks double booking but not back-to-back or the same shift', () => {
    expect(equipmentEligibility(shift, { ...base, others: [other('o1', '2026-11-05T04:00:00Z', '2026-11-05T08:00:00Z')] }).blocks)
      .toEqual([{ code: 'double_booked', message: 'Forklift 2 is already booked Thu 05 Nov 07:00–15:00 at North Yard' }]);
    expect(equipmentEligibility(shift, { ...base, others: [other('o1', '2026-11-05T05:00:00Z', '2026-11-05T09:00:00Z')] }).eligible).toBe(true);
    expect(equipmentEligibility(shift, { ...base, others: [other('s1', '2026-11-04T21:00:00Z', '2026-11-05T05:00:00Z')] }).eligible).toBe(true);
  });

  it('needs an operator holding a current, verified credential', () => {
    expect(equipmentEligibility(shift, withOperator)).toMatchObject({
      eligible: true, warnings: [{ code: 'operator', message: 'Forklift 2 needs an operator holding a Forklift licence; nobody is on this shift yet' }],
    });
    const person = (credentials: CredentialFacts[]) => ({ ...withOperator, person: { name: 'Ana Example', credentials } });
    expect(equipmentEligibility(shift, person([licence()]))).toEqual({ eligible: true, blocks: [], warnings: [] });
    const none = equipmentEligibility(shift, person([]));
    expect(none.blocks).toEqual([{ code: 'operator', message: "Ana Example doesn't hold a current, verified Forklift licence, needed to operate Forklift 2" }]);
    expect(equipmentEligibility(shift, person([licence({ verification: 'unverified' })])).eligible).toBe(false);
    expect(equipmentEligibility(shift, person([licence({ expiryDate: '2026-11-04' })])).eligible).toBe(false);
    expect(equipmentEligibility(shift, person([licence({ expiryDate: '2026-11-04' }), licence({ id: 'c2', expiryDate: '2029-01-01' })])).eligible).toBe(true);
    expect(equipmentEligibility(shift, person([licence({ expiryDate: '2026-11-20' })])).warnings)
      .toEqual([{ code: 'operator', message: "Ana Example's Forklift licence expires soon (needed to operate Forklift 2)" }]);
  });
});

describe('operator needs when putting a person on a shift', () => {
  const p: EligibilityInput = {
    name: 'Ana Example', roles: ['Operator'], issues: [], others: [], hoursPerFortnight: null, minRestHours: 10,
    operatorNeeds: [{ equipmentName: 'Forklift 2', credentialTypeId: 'lf', typeName: 'Forklift licence' }], windowDays: 30,
  };
  it('blocks a person who can\'t operate equipment already on the shift', () => {
    expect(shiftEligibility(shift, { ...p, credentials: [] }).blocks.map(b => b.code)).toEqual(['operator']);
    expect(shiftEligibility(shift, { ...p, credentials: [licence()] }).eligible).toBe(true);
  });
});
