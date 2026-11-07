import { describe, expect, it } from 'vitest';
import { detailDecidedMessage, detailLines, detailTitle, swapDecidedMessage, swapsToDecide, swapTitle, type OfficeSwap } from '../src/requests';

const sh = { localDate: '2026-11-09', localStart: '07:00', localEnd: '15:00', role: 'Chef', site: 'Harbour Kitchen', area: null };
const swap = (over: Partial<OfficeSwap>): OfficeSwap => ({
  id: 'a', status: 'agreed', fromName: 'Ana Example', toName: 'Ben Example', summary: 's', stateLine: 'x', shift: sh, other: null, canDecide: true, ...over,
});

describe('more requests on the manager side', () => {
  it('names swaps and hand-overs, and keeps only those waiting for the office', () => {
    expect(swapTitle(swap({}))).toBe('Hand over: Ana Example to Ben Example');
    expect(swapTitle(swap({ other: sh }))).toBe('Swap: Ana Example and Ben Example');
    expect(swapsToDecide([swap({ id: '1' }), swap({ id: '2', status: 'asked' })]).map(s => s.id)).toEqual(['1']);
    expect(swapDecidedMessage('approve')).toBe('Approved. Both have been told.');
    expect(swapDecidedMessage('refuse')).toMatch(/^Not approved/);
  });

  it('says what a detail change asks for, what it was and what it is now', () => {
    expect(detailTitle({ workerName: 'Ana Example', what: 'Change mobile' })).toBe('Ana Example · Change mobile');
    expect(detailLines({ askedLine: '0411 111 111', wasLine: '0498 765 432', nowLine: null })).toEqual(['Asked for: 0411 111 111', 'Was: 0498 765 432']);
    expect(detailLines({ askedLine: '5 Sample Lane', wasLine: null, nowLine: null })).toEqual(['Asked for: 5 Sample Lane']);
    expect(detailLines({ askedLine: 'a', wasLine: 'b', nowLine: 'c' })[2]).toBe('Now (changed since): c');
    expect(detailDecidedMessage('approve', 'app')).toBe('Approved and changed. They have been told in the app.');
    expect(detailDecidedMessage('decline', 'email')).toBe('Declined. They have been told by email.');
    expect(detailDecidedMessage('decline', null)).toBe('Declined.');
  });
});
