import { describe, expect, it } from 'vitest';
import { kpiNote, kpiOrder, kpiValue, type Kpi } from '../src/manager';
import {
  approvedLeaveMessage, attentionHeading, canDecide, changeRequestShift, isManager, leaveRequestLine, requestsTab, roleOf, shiftWhere, shiftWord, startMode, todayIn,
} from '../src/manager';

describe('manager mode', () => {
  it('opens in manager mode for office roles only', () => {
    expect(['owner', 'admin', 'allocator'].map(isManager)).toEqual([true, true, true]);
    expect(['worker', 'client', null, undefined].map(isManager)).toEqual([false, false, false, false]);
    expect(startMode('allocator')).toBe('manager');
    expect(startMode('worker')).toBe('worker');
    expect([canDecide('owner'), canDecide('admin'), canDecide('allocator'), canDecide('worker')]).toEqual([true, true, false, false]);
    const me = { memberships: [{ tenantSlug: 'cafe', role: 'owner' }, { tenantSlug: 'ward', role: 'worker' }] };
    expect(roleOf(me, 'ward')).toBe('worker');
    expect(roleOf(me, 'other')).toBeNull();
  });

  it('words the Needs attention heading', () => {
    expect(attentionHeading({ total: 0, urgent: 0, days: 7 })).toBe('Nothing needs attention in the next 7 days.');
    expect(attentionHeading({ total: 1, urgent: 0, days: 7 })).toBe('1 thing in the next 7 days');
    expect(attentionHeading({ total: 3, urgent: 1, days: 7 })).toBe('3 things in the next 7 days · 1 within a day');
  });

  it('describes the shift an item or request is about', () => {
    const s = { facilityName: 'Main St', areaName: 'Kitchen', role: 'Cook', localDate: '2026-11-02', localStart: '07:00', localEnd: '15:30', workerName: null };
    expect(shiftWhere(s)).toBe('Mon 2 Nov 07:00–15:30 · Cook · Kitchen · Main St');
    expect(shiftWhere({ ...s, areaName: null }, '2026-11-02')).toBe('Today 07:00–15:30 · Cook · Main St');
    expect(changeRequestShift({ id: 'r', summary: '', requestedByName: null, reason: null, canDecide: true, ...s }, '2026-11-01')).toBe('Tomorrow 07:00–15:30 · Cook · Kitchen · Main St');
  });

  it('words leave requests and what approving means', () => {
    const l = { id: 'l', workerName: 'Sam Lee', kind: 'annual', startsOn: '2026-11-02', endsOn: '2026-11-04', days: 3, status: 'requested', note: null };
    expect(leaveRequestLine(l)).toBe('Sam Lee · Annual · Mon 2 Nov – Wed 4 Nov (3 days)');
    expect(leaveRequestLine({ ...l, kind: 'mystery', endsOn: '2026-11-02', days: 1 })).toBe('Sam Lee · Other · Mon 2 Nov');
    const w = { lower: 'shift', lowerMany: 'shifts' };
    expect(approvedLeaveMessage(0, w)).toBe('Approved. They have nothing rostered in those days.');
    expect(approvedLeaveMessage(1, w)).toBe('Approved. 1 shift needs someone else: they show in Needs attention.');
    expect(approvedLeaveMessage(2, { lower: 'job', lowerMany: 'jobs' })).toBe('Approved. 2 jobs need someone else: they show in Needs attention.');
    expect(requestsTab(0, 0)).toBe('Requests');
    expect(requestsTab(2, 1)).toBe('Requests (3)');
  });

  it("uses the business's word for shifts", () => {
    expect(shiftWord(null)).toEqual({ one: 'Shift', many: 'Shifts', lower: 'shift', lowerMany: 'shifts' });
    expect(shiftWord([{ key: 'worker', singular: 'Crew', plural: 'Crew' }, { key: 'shift', singular: 'Job', plural: 'Jobs' }]).lowerMany).toBe('jobs');
  });

  it("works out today in the business's time zone", () => {
    const now = new Date('2026-10-30T16:00:00Z'); // 3am on the 31st in Melbourne
    expect(todayIn('Australia/Melbourne', now)).toBe('2026-10-31');
    expect(todayIn('Europe/London', now)).toBe('2026-10-30');
    expect(todayIn(null, now)).toBeUndefined();
    expect(todayIn('Not/AZone', now)).toBeUndefined();
  });
});


describe('dashboard numbers on the phone', () => {
  const k = (o: Partial<Kpi>): Kpi => ({ key: 'x', label: 'X', unit: 'percent', better: 'higher', value: 90, detail: '2 left', target: null, standing: 'no_target', ...o });
  it('words values like the web', () => {
    expect(kpiValue(null, 'count')).toBe('–');
    expect(kpiValue(92.5, 'percent')).toBe('92.5%');
    expect(kpiValue(1, 'days')).toBe('1 day');
  });
  it('says off target first, then the change, then the detail', () => {
    expect(kpiNote(k({ standing: 'off_target', target: 95, weekAgo: 80 }))).toEqual({ text: 'Off target (at least 95%)', tone: 'bad' });
    expect(kpiNote(k({ weekAgo: 80 }))).toEqual({ text: 'Up from 80% a week ago', tone: 'good' });
    expect(kpiNote(k({ unit: 'hours', better: 'lower', value: 30, weekAgo: 24 }))).toEqual({ text: 'Up from 24 hours a week ago', tone: 'bad' });
    expect(kpiNote(k({ weekAgo: 90 }))).toEqual({ text: '2 left', tone: 'plain' });
  });
  it('puts numbers off target first', () => {
    expect(kpiOrder([k({ key: 'a' }), k({ key: 'b', standing: 'off_target' })]).map(x => x.key)).toEqual(['b', 'a']);
  });
});
