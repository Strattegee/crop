import { describe, expect, it } from 'vitest';
import {
  anchorForSwitch, anchorOf, barPosition, dayWindow, daySummary, parseSpan, rangeFor, tickLabel, weeksOf,
} from '../app/(office)/roster/view';

const TODAY = '2026-10-28'; // a Wednesday

describe('roster views', () => {
  it('reads the span and anchor from the address, falling back safely', () => {
    expect(parseSpan('day')).toBe('day');
    expect(parseSpan('month')).toBe('month');
    expect(parseSpan('year')).toBe('week');
    expect(anchorOf({ date: '2026-11-03' }, TODAY)).toBe('2026-11-03');
    expect(anchorOf({ week: '2026-11-02' }, TODAY)).toBe('2026-11-02');
    expect(anchorOf({ date: '2026-02-30' }, TODAY)).toBe(TODAY);
    expect(anchorOf({ date: 'nonsense' }, TODAY)).toBe(TODAY);
  });

  it('week view shows Monday to Sunday', () => {
    const r = rangeFor('week', TODAY, TODAY);
    expect(r.days).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect([r.prev, r.next, r.current]).toEqual(['2026-10-19', '2026-11-02', '2026-10-26']);
  });

  it('day view shows one day but fetches its week for hours against contract', () => {
    const r = rangeFor('day', '2026-11-01', TODAY);
    expect(r.days).toEqual(['2026-11-01']);
    expect([r.fetchFrom, r.fetchTo, r.week]).toEqual(['2026-10-26', '2026-11-01', '2026-10-26']);
    expect([r.prev, r.next]).toEqual(['2026-10-31', '2026-11-02']);
  });

  it('month view covers whole weeks from the Monday before the 1st to the Sunday after the last day', () => {
    const r = rangeFor('month', '2026-11-17', TODAY);
    expect(r.anchor).toBe('2026-11-01');
    expect(r.fetchFrom).toBe('2026-10-26');
    expect(r.fetchTo).toBe('2026-12-06');
    expect(r.days).toHaveLength(42);
    expect(weeksOf(r.days)).toHaveLength(6);
    expect([r.prev, r.next, r.current]).toEqual(['2026-10-01', '2026-12-01', '2026-10-01']);
    // February 2027 starts on a Monday and has exactly four weeks.
    expect(rangeFor('month', '2027-02-10', TODAY).days).toHaveLength(28);
    // Across a year end.
    expect(rangeFor('month', '2026-12-31', TODAY).next).toBe('2027-01-01');
  });

  it('switching view keeps today when it is on screen, else the first day shown', () => {
    const week = rangeFor('week', TODAY, TODAY);
    expect(anchorForSwitch(week, 'day', TODAY)).toBe(TODAY);
    expect(anchorForSwitch(rangeFor('week', '2026-11-09', TODAY), 'day', TODAY)).toBe('2026-11-09');
    expect(anchorForSwitch(rangeFor('day', '2026-11-12', TODAY), 'week', TODAY)).toBe('2026-11-09');
    expect(anchorForSwitch(rangeFor('day', '2026-11-12', TODAY), 'month', TODAY)).toBe('2026-11-01');
    // The November grid starts on 26 Oct, but switching to day lands on 1 Nov, not a day of October.
    expect(anchorForSwitch(rangeFor('month', '2026-11-05', TODAY), 'day', TODAY)).toBe('2026-11-01');
  });

  it('the day timeline spans the day’s shifts, at least eight hours, overnight shifts past midnight', () => {
    expect(dayWindow([])).toMatchObject({ from: 360, to: 1320 });
    const w = dayWindow([{ localStart: '07:00', localEnd: '15:30' }, { localStart: '21:00', localEnd: '07:00' }]);
    expect([w.from, w.to]).toEqual([420, 1860]);
    const short = dayWindow([{ localStart: '10:00', localEnd: '14:00' }]);
    expect(short.to - short.from).toBe(480);
    expect(short.from).toBe(480);
    expect(dayWindow([{ localStart: '01:00', localEnd: '03:00' }]).from).toBe(0);
  });

  it('places bars on the timeline', () => {
    const w = { from: 360, to: 1320, ticks: [] };
    expect(barPosition({ localStart: '06:00', localEnd: '14:00' }, w)).toEqual({ left: 0, width: 50 });
    expect(barPosition({ localStart: '18:00', localEnd: '02:00' }, w)).toEqual({ left: 75, width: 25 });
    expect(tickLabel(360)).toBe('6am');
    expect(tickLabel(720)).toBe('12pm');
    expect(tickLabel(1440)).toBe('12am');
    expect(tickLabel(1800)).toBe('6am');
  });

  it('sums a day for the month calendar', () => {
    const shifts = [
      { localDate: '2026-11-02', status: 'booked', hours: 8 },
      { localDate: '2026-11-02', status: 'assigned', hours: 7.5 },
      { localDate: '2026-11-02', status: 'open', hours: 8 },
      { localDate: '2026-11-02', status: 'cancelled', hours: 8 },
      { localDate: '2026-11-02', status: 'booked', hours: 10, equipmentOnly: true },
      { localDate: '2026-11-03', status: 'booked', hours: 8 },
    ];
    const leave = [
      { workerId: 'a', status: 'approved', startsOn: '2026-11-01', endsOn: '2026-11-05' },
      { workerId: 'b', status: 'requested', startsOn: '2026-11-02', endsOn: '2026-11-02' },
    ];
    expect(daySummary('2026-11-02', shifts, leave)).toEqual({ shifts: 3, filled: 2, open: 1, hours: 15.5, cancelled: 1, onLeave: 1 });
  });
});

describe('day timeline lanes and month week states', () => {
  it('stacks overlapping shifts and reuses a lane once it is free', async () => {
    const { lanes } = await import('../app/(office)/roster/view');
    const r = lanes([
      { id: 'a', localStart: '07:00', localEnd: '15:00' },
      { id: 'b', localStart: '09:00', localEnd: '17:00' },
      { id: 'c', localStart: '15:00', localEnd: '23:00' },
      { id: 'd', localStart: '22:00', localEnd: '06:00' },
    ]);
    expect(r.count).toBe(2);
    expect([r.lane.get('a'), r.lane.get('b'), r.lane.get('c'), r.lane.get('d')]).toEqual([0, 1, 0, 1]);
    expect(lanes([]).count).toBe(1);
  });

  it('summarises the sites of a week', async () => {
    const { weekStateLabel } = await import('../app/(office)/roster/view');
    const row = (state: 'draft' | 'live' | 'history', changes = 0, shifts = 3) => ({ state, shifts, version: state === 'draft' ? null : 1, changesSincePublish: changes });
    expect(weekStateLabel([])).toBeNull();
    expect(weekStateLabel([{ state: 'draft', shifts: 0, version: null, changesSincePublish: 0 }])).toBeNull();
    expect(weekStateLabel([row('history'), row('history')])).toEqual({ cls: 'history', text: 'History' });
    expect(weekStateLabel([row('draft')])).toEqual({ cls: 'draft', text: 'Draft' });
    expect(weekStateLabel([row('draft'), row('live')])).toEqual({ cls: 'draft', text: '1 of 2 sites in draft' });
    expect(weekStateLabel([row('live', 2), row('live', 1)])).toEqual({ cls: 'live', text: 'Live · 3 changes since' });
    expect(weekStateLabel([row('live')])).toEqual({ cls: 'live', text: 'Live' });
  });
});
