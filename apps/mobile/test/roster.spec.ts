import { describe, expect, it } from 'vitest';
import {
  currentWeek, dayChip, firstDay, openOn, publishedMessage, publishLabel, shiftLine, summaryLine, termWord, unfilled, weekDates, weekRowsShown,
  weekStateLine, weekTitle, type RosterShift, type WeekRow,
} from '../src/roster';

const word = { lower: 'shift', lowerMany: 'shifts' };

function shift(over: Partial<RosterShift> = {}): RosterShift {
  return {
    id: 's1', facilityId: 'f1', facilityName: 'Main St', areaName: 'Kitchen', role: 'Cook', status: 'open', equipmentOnly: false,
    localDate: '2026-11-02', localStart: '07:00', localEnd: '15:30', hours: 8, workerId: null, workerName: null, assignmentStatus: null,
    agencyName: null, offersPending: 0, pulledOutName: null, coveringName: null, cancelledReason: null, notes: null, shiftLetter: null, ...over,
  };
}

function week(over: Partial<WeekRow> = {}): WeekRow {
  return {
    facilityId: 'f1', facilityName: 'Main St', weekStart: '2026-11-02', state: 'draft', version: null, publishedAt: null, publishedByName: null,
    changesSincePublish: 0, shifts: 0, changeRefusal: null, pendingRequests: 0, ...over,
  };
}

describe('roster in manager mode', () => {
  it('works out the week and the day to open on', () => {
    expect(weekDates('2026-11-02')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(currentWeek('2026-11-05', '2026-01-01')).toBe('2026-11-02');
    expect(currentWeek(undefined, '2026-11-08')).toBe('2026-11-02');
    expect(firstDay('2026-11-02', '2026-11-05')).toBe('2026-11-05');
    expect(firstDay('2026-11-09', '2026-11-05')).toBe('2026-11-09');
    expect(firstDay('2026-11-02')).toBe('2026-11-02');
  });

  it('names the week and the days', () => {
    expect(weekTitle('2026-11-02')).toBe('2–8 Nov');
    expect(weekTitle('2026-11-30')).toBe('30 Nov – 6 Dec');
    expect(weekTitle('2026-11-02', '2026-11-04')).toBe('This week · 2–8 Nov');
    expect(weekTitle('2026-11-09', '2026-11-04')).toBe('Next week · 9–15 Nov');
    expect(weekTitle('2026-10-26', '2026-11-04')).toBe('Last week · 26 Oct – 1 Nov');
    expect(weekTitle('2026-11-16', '2026-11-04')).toBe('16–22 Nov');
    expect(dayChip('2026-11-02')).toBe('Mon 2');
    expect(dayChip('2026-11-02', '2026-11-02')).toBe('Today');
  });

  it('counts unfilled shifts and hours', () => {
    const list = [
      shift(),
      shift({ id: 's2', workerId: 'w', workerName: 'Sam Lee', status: 'booked', assignmentStatus: 'confirmed', hours: 7.5 }),
      shift({ id: 's3', status: 'cancelled' }),
      shift({ id: 's4', equipmentOnly: true }),
      shift({ id: 's5', localDate: '2026-11-03' }),
    ];
    expect(list.map(unfilled)).toEqual([true, false, false, false, true]);
    expect(openOn(list, '2026-11-02')).toBe(1);
    expect(summaryLine(list, word)).toBe('4 shifts · 2 unfilled · 7.5 h filled');
    expect(summaryLine([list[1]], { lower: 'job', lowerMany: 'jobs' })).toBe('1 job · 7.5 h filled');
    expect(summaryLine([list[2]], word)).toBe('No shifts');
    expect(shiftLine(shift())).toBe('07:00–15:30 · Cook · Kitchen');
    expect(shiftLine(shift({ shiftLetter: 'D', areaName: null }))).toBe('D 07:00–15:30 · Cook');
  });

  it('says where each site is with publishing', () => {
    expect(weekStateLine(week(), word)).toBe('Draft · nothing on this week yet');
    expect(weekStateLine(week({ shifts: 1 }), word)).toBe('Draft · 1 shift, not published yet');
    expect(weekStateLine(week({ state: 'live', version: 1, publishedByName: 'Sam Lee', shifts: 4 }), word)).toBe('Live · published by Sam Lee');
    expect(weekStateLine(week({ state: 'live', version: 2, changesSincePublish: 3 }), word)).toBe('Live · published · 3 changes since');
    expect(weekStateLine(week({ state: 'history' }), word)).toMatch(/^History/);
    const rows = [week({ shifts: 3 }), week({ facilityId: 'f2', facilityName: 'Pier' }), week({ facilityId: 'f3', state: 'live', version: 1 })];
    expect(weekRowsShown(rows, null).map(w => w.facilityId)).toEqual(['f1', 'f3']);
    expect(weekRowsShown(rows, 'f2').map(w => w.facilityId)).toEqual(['f2']);
  });

  it('labels Publish like the web', () => {
    expect(publishLabel([week({ shifts: 3 })])).toBe('Publish week');
    expect(publishLabel([week()])).toBeNull();
    expect(publishLabel([week({ state: 'live', version: 1, changesSincePublish: 1 })])).toBe('Publish 1 change');
    expect(publishLabel([week({ state: 'live', version: 1, changesSincePublish: 2 }), week({ facilityId: 'f2', state: 'live', version: 1, changesSincePublish: 1 })])).toBe('Publish 3 changes');
    expect(publishLabel([week({ state: 'live', version: 1 })])).toBeNull();
    expect(publishLabel([week({ state: 'history', shifts: 5 })])).toBeNull();
    const people = { lowerMany: 'staff' };
    expect(publishedMessage({ messages: 0 }, false, people, word)).toBe('Published. The week is live; changes from now on are logged. No messages sent.');
    expect(publishedMessage({ messages: 0 }, true, people, word)).toMatch(/Nobody needed a message\.$/);
    expect(publishedMessage({ messages: 1 }, true, people, word)).toMatch(/1 message sent to staff with their shifts\.$/);
    expect(publishedMessage({ messages: 4 }, true, people, word)).toMatch(/4 messages sent/);
  });

  it("uses the business's words", () => {
    expect(termWord([{ key: 'site', singular: 'Venue', plural: 'Venues' }], 'site', 'Site', 'Sites')).toEqual({ one: 'Venue', many: 'Venues', lower: 'venue', lowerMany: 'venues' });
    expect(termWord(null, 'worker', 'Worker', 'Workers').lowerMany).toBe('workers');
  });
});
