import { describe, expect, it } from 'vitest';
import { fortnightsContaining, mondayOf, shiftEligibility, type EligibilityInput, type OtherShift, type ShiftFacts } from '../src/roster/eligibility.js';
import type { ComplianceIssue } from '../src/workforce/compliance.js';

const at = (s: string) => new Date(s);
const shift: ShiftFacts = { id: 's1', role: 'Chef', startsAt: at('2026-11-04T21:00:00Z'), endsAt: at('2026-11-05T05:00:00Z'), localDate: '2026-11-05', hours: 8 };
const other = (id: string, start: string, end: string, localDate: string, hours: number): OtherShift =>
  ({ id, role: 'Chef', startsAt: at(start), endsAt: at(end), localDate, hours, facilityName: 'Harbour Kitchen', label: `${localDate} shift` });
const base: EligibilityInput = { name: 'Ana Example', roles: ['Chef'], issues: [], others: [], hoursPerFortnight: null, minRestHours: 10 };
const issue = (over: Partial<ComplianceIssue>): ComplianceIssue =>
  ({ credentialTypeId: 'food', typeName: 'Food handling', severity: 'hard', problem: 'missing', credentialId: null, ...over });

describe('fortnights', () => {
  it('finds the Monday of the week and both 14-day periods starting on a Monday', () => {
    expect(mondayOf('2026-11-05')).toBe('2026-11-02'); // Thursday
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02'); // Sunday
    expect(fortnightsContaining('2026-11-05')).toEqual([{ from: '2026-10-26', to: '2026-11-08' }, { from: '2026-11-02', to: '2026-11-15' }]);
  });
});

describe('shift eligibility', () => {
  it('is eligible with the role and nothing else in the way', () => {
    expect(shiftEligibility(shift, base)).toEqual({ eligible: true, blocks: [], warnings: [] });
    expect(shiftEligibility(shift, { ...base, roles: ['chef'] }).eligible).toBe(true); // case doesn't matter
  });

  it('blocks the wrong role', () => {
    const r = shiftEligibility(shift, { ...base, roles: ['Barista'] });
    expect(r.blocks).toEqual([{ code: 'role', message: "Ana Example doesn't have the role Chef" }]);
  });

  it('blocks hard credential and right-to-work problems; warns on expiring and warning-level rules', () => {
    const r = shiftEligibility(shift, {
      ...base,
      issues: [
        issue({ problem: 'expired' }),
        issue({ credentialTypeId: 'right-to-work', typeName: 'Right to work', problem: 'no_work_rights' }),
        issue({ typeName: 'First aid', problem: 'expiring' }),
        issue({ typeName: 'Flu vaccination', severity: 'warning', problem: 'missing' }),
      ],
    });
    expect(r.eligible).toBe(false);
    expect(r.blocks.map(b => b.code)).toEqual(['credential', 'right_to_work']);
    expect(r.blocks[0].message).toBe("Ana Example's Food handling will have expired by the shift date");
    expect(r.warnings.map(w => w.message)).toEqual(["Ana Example's First aid expires soon", "Ana Example's Flu vaccination is missing"]);
  });

  it('blocks overlapping shifts but ignores the shift itself', () => {
    const clash = other('s2', '2026-11-05T04:00:00Z', '2026-11-05T09:00:00Z', '2026-11-05', 5);
    expect(shiftEligibility(shift, { ...base, others: [clash] }).blocks[0]).toMatchObject({ code: 'double_booked' });
    const itself = other('s1', '2026-11-04T21:00:00Z', '2026-11-05T05:00:00Z', '2026-11-05', 8);
    expect(shiftEligibility(shift, { ...base, others: [itself] }).eligible).toBe(true);
    // Back to back is not an overlap.
    const after = other('s3', '2026-11-05T05:00:00Z', '2026-11-05T09:00:00Z', '2026-11-05', 4);
    expect(shiftEligibility(shift, { ...base, others: [after], minRestHours: 0 }).eligible).toBe(true);
  });

  it('blocks going over a visa limit in any fortnight starting on a Monday', () => {
    // 40 hours already in the week before: the fortnight 26 Oct–8 Nov would reach 48 with this shift (allowed) …
    const before = [other('a', '2026-10-27T21:00:00Z', '2026-10-28T05:00:00Z', '2026-10-28', 40)];
    expect(shiftEligibility(shift, { ...base, others: before, hoursPerFortnight: 48 }).eligible).toBe(true);
    // … but one more hour is over.
    const r = shiftEligibility(shift, { ...base, others: [...before, other('b', '2026-11-08T21:00:00Z', '2026-11-08T22:00:00Z', '2026-11-08', 1)], hoursPerFortnight: 48 });
    expect(r.blocks).toEqual([{ code: 'visa_hours', message: expect.stringMatching(/allows 48 hours a fortnight; this shift would make 49 hours in the fortnight from Mon 26 Oct/) }]);
    // Hours in the following fortnight count too.
    const later = [other('c', '2026-11-11T21:00:00Z', '2026-11-12T05:00:00Z', '2026-11-12', 41)];
    expect(shiftEligibility(shift, { ...base, others: later, hoursPerFortnight: 48 }).blocks[0].message).toMatch(/fortnight from Mon 2 Nov/);
    // Shifts outside both fortnights don't count.
    const far = [other('d', '2026-11-16T21:00:00Z', '2026-11-17T05:00:00Z', '2026-11-17', 60)];
    expect(shiftEligibility(shift, { ...base, others: far, hoursPerFortnight: 48 }).eligible).toBe(true);
  });

  it('warns when rest between shifts is under the minimum, either side', () => {
    const before = other('e', '2026-11-04T08:00:00Z', '2026-11-04T13:00:00Z', '2026-11-04', 5); // ends 8 hours before
    const r = shiftEligibility(shift, { ...base, others: [before] });
    expect(r.eligible).toBe(true);
    expect(r.warnings).toEqual([{ code: 'rest', message: "Ana Example would have 8 hours' rest between this shift and 2026-11-04 shift (minimum 10)" }]);
    const after = other('f', '2026-11-05T12:00:00Z', '2026-11-05T18:00:00Z', '2026-11-05', 6); // starts 7 hours after
    expect(shiftEligibility(shift, { ...base, others: [after] }).warnings[0].message).toMatch(/7 hours' rest/);
    expect(shiftEligibility(shift, { ...base, others: [after], minRestHours: 0 }).warnings).toEqual([]);
    expect(shiftEligibility(shift, { ...base, others: [after], minRestHours: 6 }).warnings).toEqual([]);
  });
});
