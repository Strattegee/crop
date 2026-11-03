import { describe, expect, it } from 'vitest';
import { afterYesLine, askedMessage, canSwap, mySwapLine, swapOrder, whenLine, type MySwap } from '../src/swaps';

const A = { id: 'a', localDate: '2026-11-09', localStart: '07:00', localEnd: '15:00', role: 'Chef', site: 'Harbour Kitchen', area: null };
const B = { id: 'b', localDate: '2026-11-10', localStart: '15:00', localEnd: '23:00', role: 'Chef', site: 'Harbour Kitchen', area: null };
const swap = (over: Partial<MySwap>): MySwap => ({
  id: 's', status: 'asked', mine: true, colleague: 'Ben Example', shift: A, other: null, line: '', stateLine: '', canAnswer: false, canWithdraw: false, ...over,
});

describe('worker app: shift swaps', () => {
  it('words a swap from the person\'s side', () => {
    expect(whenLine(A)).toBe('Mon 9 Nov 07:00–15:00');
    expect(whenLine(A, '2026-11-09')).toBe('Today 07:00–15:00');
    expect(mySwapLine(swap({}))).toBe('You asked Ben Example to take Mon 9 Nov 07:00–15:00');
    expect(mySwapLine(swap({ mine: false, colleague: 'Ana Example' }))).toBe('Ana Example asks you to take Mon 9 Nov 07:00–15:00');
    expect(mySwapLine(swap({ other: B }))).toBe('Swap with Ben Example: you give Mon 9 Nov 07:00–15:00, you get Tue 10 Nov 15:00–23:00');
    // The colleague gives their own shift (the other one) and gets the asker's.
    expect(mySwapLine(swap({ other: B, mine: false, colleague: 'Ana Example' })))
      .toBe('Ana Example asks to swap: you give Tue 10 Nov 15:00–23:00, you get Mon 9 Nov 07:00–15:00');
  });

  it('puts asks waiting for an answer first', () => {
    const list = [swap({ id: 'done', status: 'done' }), swap({ id: 'mine', canWithdraw: true }), swap({ id: 'answer', canAnswer: true })];
    expect(swapOrder(list).map(s => s.id)).toEqual(['answer', 'mine', 'done']);
  });

  it('offers a swap only when swaps are on and nothing is asked about the shift', () => {
    expect(canSwap('a', 'off', [])).toBe(false);
    expect(canSwap('a', undefined, [])).toBe(false);
    expect(canSwap('a', 'approve', [])).toBe(true);
    expect(canSwap('a', 'approve', [swap({ status: 'asked' })])).toBe(false);
    expect(canSwap('a', 'approve', [swap({ status: 'declined' })])).toBe(true);
    expect(canSwap('a', 'automatic', [swap({ status: 'agreed', mine: false })])).toBe(true);
  });

  it('says what happens next', () => {
    expect(afterYesLine('approve')).toMatch(/office approves/);
    expect(afterYesLine('automatic')).toMatch(/straight away/);
    expect(askedMessage('Ben Example', 'approve')).toBe("We've asked Ben Example. You stay on your shift until they say yes and the office approves.");
    expect(askedMessage('Ben Example', 'automatic', 'job')).toBe("We've asked Ben Example. You stay on your job until they say yes.");
  });
});
