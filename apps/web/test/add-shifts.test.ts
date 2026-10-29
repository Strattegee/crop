import { describe, expect, it } from 'vitest';
import { addShiftsDates, addShiftsUntil, addShiftsWhen } from '../app/(office)/roster/view';

describe('Add shifts dates (David, 29 Oct)', () => {
  it('puts a ticked day in the week from From when Until is blank', () => {
    const until = addShiftsUntil('2026-10-26', undefined, [5]);
    expect(until).toBe('2026-11-01');
    expect(addShiftsDates('2026-10-26', until, [5])).toEqual(['2026-10-30']);
    expect(addShiftsWhen(['2026-10-30'])).toBe(' on Fri 30 Oct');
  });
  it('makes one shift on From when nothing is ticked and Until is blank', () => {
    expect(addShiftsUntil('2026-10-26', undefined, [])).toBeUndefined();
    expect(addShiftsDates('2026-10-26', undefined, [])).toEqual(['2026-10-26']);
  });
  it('keeps Until when given and counts the days', () => {
    const dates = addShiftsDates('2026-10-26', addShiftsUntil('2026-10-26', '2026-11-08', [1, 3]), [1, 3]);
    expect(dates).toEqual(['2026-10-26', '2026-10-28', '2026-11-02', '2026-11-04']);
    expect(addShiftsWhen(dates)).toBe(' on 4 days, Mon 26 Oct to Wed 4 Nov');
  });
});
