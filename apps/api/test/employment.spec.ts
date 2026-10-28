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

import { employmentReason, endPlan } from '../src/roster/employment.js';

describe('end of employment (pure)', () => {
  it('ends the latest open terms, not before they start, once', () => {
    expect(endPlan(terms, '2026-12-31')).toEqual({ ok: true, id: 'c' });
    expect(endPlan(terms, '2026-11-01')).toEqual({ ok: true, id: 'c' });
    expect(endPlan(terms, '2026-10-31')).toMatchObject({ ok: false, message: expect.stringMatching(/before their latest terms start/) });
    expect(endPlan([], '2026-10-31')).toMatchObject({ ok: false, message: 'Record their employment before ending it' });
    expect(endPlan([{ id: 'x', startsOn: '2026-01-01', endsOn: '2026-05-01', endReason: 'resigned' }], '2026-06-01'))
      .toMatchObject({ ok: false, message: expect.stringMatching(/already ends on 2026-05-01; undo/) });
  });

  it('blocks after the end and in a gap, warns before the first terms, ignores people with no terms', () => {
    const spells = [
      { id: 'a', startsOn: '2026-01-01', endsOn: '2026-03-31' },
      { id: 'b', startsOn: '2026-06-01', endsOn: '2026-10-30' },
    ];
    expect(employmentReason('Sam', '2026-02-01', spells)).toBeNull();
    expect(employmentReason('Sam', '2026-10-30', spells)).toBeNull();
    expect(employmentReason('Sam', '2026-10-31', spells)).toEqual({ hard: true, message: "Sam's employment ended on Fri 30 Oct 2026" });
    expect(employmentReason('Sam', '2026-04-15', spells)).toEqual({ hard: true, message: "Sam's employment ended on Tue 31 Mar 2026" });
    expect(employmentReason('Sam', '2025-12-01', spells)).toEqual({ hard: false, message: "Sam's employment is only recorded from Thu 1 Jan 2026" });
    expect(employmentReason('Sam', '2030-01-01', [])).toBeNull();
    expect(employmentReason('Sam', '2030-01-01', [{ id: 'c', startsOn: '2026-01-01', endsOn: null }])).toBeNull();
  });

  it('keeps an earlier spell ended when correcting or withdrawing terms after a gap', () => {
    const spells = [
      { id: 'a', startsOn: '2026-01-01', endsOn: '2026-03-31' },
      { id: 'b', startsOn: '2026-06-01', endsOn: null },
    ];
    expect(withdrawalPlan(spells, 'b')).toEqual({ ok: true, previousId: null, previousEndsOn: null });
    expect(correctionPlan(spells, 'b', '2026-05-01')).toEqual({ ok: true, previousId: null, previousEndsOn: null });
    expect(correctionPlan(spells, 'b', '2026-03-31')).toMatchObject({ ok: false, message: expect.stringMatching(/after their earlier employment ended/) });
  });
});
