import { describe, expect, it } from 'vitest';
import { correctionPlan, dayBefore, withdrawalPlan } from '../src/roster/employment.js';

const terms = [
  { id: 'a', startsOn: '2026-01-01', endsOn: '2026-06-30' },
  { id: 'b', startsOn: '2026-07-01', endsOn: '2026-10-31' },
  { id: 'c', startsOn: '2026-11-01', endsOn: null },
];

describe('employment corrections (pure)', () => {
  it('fixes type or hours on any live term without moving dates', () => {
    expect(correctionPlan(terms, 'a', null)).toEqual({ ok: true, previousId: null, previousEndsOn: null });
    expect(correctionPlan(terms, 'b', '2026-07-01')).toEqual({ ok: true, previousId: null, previousEndsOn: null });
  });

  it('moves the start of the latest term only, after the previous one started', () => {
    expect(correctionPlan(terms, 'c', '2026-11-15')).toEqual({ ok: true, previousId: 'b', previousEndsOn: '2026-11-14' });
    expect(correctionPlan(terms, 'c', '2026-07-02')).toEqual({ ok: true, previousId: 'b', previousEndsOn: '2026-07-01' });
    expect(correctionPlan(terms, 'c', '2026-07-01')).toMatchObject({ ok: false, message: expect.stringMatching(/after the previous terms started/) });
    expect(correctionPlan(terms, 'b', '2026-08-01')).toMatchObject({ ok: false, message: expect.stringMatching(/Only the latest/) });
    expect(correctionPlan([{ id: 'x', startsOn: '2026-03-01', endsOn: null }], 'x', '2025-01-01')).toEqual({ ok: true, previousId: null, previousEndsOn: null });
    expect(correctionPlan(terms, 'gone', null)).toMatchObject({ ok: false });
  });

  it('withdraws only the latest term; the previous one carries on', () => {
    expect(withdrawalPlan(terms, 'c')).toEqual({ ok: true, previousId: 'b', previousEndsOn: null });
    expect(withdrawalPlan(terms, 'b')).toMatchObject({ ok: false, message: 'Only the latest employment terms can be withdrawn' });
    expect(withdrawalPlan([terms[0]], 'a')).toEqual({ ok: true, previousId: null, previousEndsOn: '2026-06-30' });
  });

  it('counts back a day across months and years', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });
});
