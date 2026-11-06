import { describe, expect, it } from 'vitest';
import {
  addableDays, addCount, addedMessage, addLabel, addShiftsBody, codeChoices, codeLabel, daysLine, defaultDays, defaultSite, hoursFor, hoursLine,
  isoWeekday, roleChoices, siteChoices, tidyTime, toggleDay, weekIsOver, type AddForm, type ShiftCodeRow,
} from '../src/add-shifts';

const word = { lower: 'shift', lowerMany: 'shifts' };
const site = { lower: 'site' };
const form = (over: Partial<AddForm> = {}): AddForm => ({
  facilityId: 'f1', areaId: null, shiftCodeId: null, startTime: '7', endTime: '1530', breakMinutes: '30', role: 'Cook',
  days: ['2026-11-10', '2026-11-12'], quantity: 2, notes: '', ...over,
});

describe('adding shifts from the phone', () => {
  it('offers the week from today and ticks the day on screen', () => {
    const d = addableDays('2026-11-02', '2026-11-05');
    expect(d.filter(x => x.past).map(x => x.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(defaultDays('2026-11-02', '2026-11-06', '2026-11-05')).toEqual(['2026-11-06']);
    expect(defaultDays('2026-11-02', '2026-11-03', '2026-11-05')).toEqual(['2026-11-05']);
    expect(defaultDays('2026-11-02', 'week', '2026-11-05')).toEqual(['2026-11-05']);
    expect(defaultDays('2026-10-26', 'week', '2026-11-05')).toEqual([]);
    expect(weekIsOver('2026-10-26', '2026-11-05')).toBe(true);
    expect(weekIsOver('2026-11-02', '2026-11-08')).toBe(false);
    expect(toggleDay(['2026-11-12'], '2026-11-10')).toEqual(['2026-11-10', '2026-11-12']);
    expect(toggleDay(['2026-11-10', '2026-11-12'], '2026-11-10')).toEqual(['2026-11-12']);
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-15')).toBe(7);
  });

  it('lists sites, roles and shift types', () => {
    const sites = siteChoices([
      { id: 'p', name: 'Tower', active: true, kind: 'project', clientName: 'Acme' },
      { id: 'b', name: 'Bay St', active: true, kind: 'site' },
      { id: 'x', name: 'Old', active: false, kind: 'site' },
      { id: 'a', name: 'Albert Rd', active: true },
    ]);
    expect(sites).toEqual([{ id: 'a', label: 'Albert Rd' }, { id: 'b', label: 'Bay St' }, { id: 'p', label: 'Tower · Acme' }]);
    expect(defaultSite(sites, 'b')).toBe('b');
    expect(defaultSite(sites, 'gone')).toBeNull();
    expect(defaultSite([{ id: 'a' }], null)).toBe('a');
    expect(roleChoices([{ name: 'Cook', active: true }, { name: 'cook', active: true }, { name: 'Barista', active: false }, { name: 'Waiter', active: true }]))
      .toEqual(['Cook', 'Waiter']);
    const c: ShiftCodeRow = { id: 'c', code: 'AM', name: 'Morning', letter: 'A', startTime: '07:00', endTime: '15:30', breakMinutes: 30, active: true };
    expect(codeLabel(c)).toBe('A · Morning · 07:00–15:30');
    expect(codeLabel({ ...c, letter: null, name: '' })).toBe('AM · 07:00–15:30');
    expect(codeChoices([c, { ...c, id: 'd', active: false }])).toEqual([c]);
  });

  it('reads times typed on a keypad', () => {
    expect(tidyTime('7')).toBe('07:00');
    expect(tidyTime('730')).toBe('07:30');
    expect(tidyTime('7.30')).toBe('07:30');
    expect(tidyTime(' 15:30 ')).toBe('15:30');
    expect(tidyTime('1530')).toBe('15:30');
    expect(tidyTime('24')).toBeNull();
    expect(tidyTime('7:75')).toBeNull();
    expect(tidyTime('soon')).toBeNull();
    expect(hoursFor('07:00', '15:30', 30)).toBe(8);
    expect(hoursFor('22:00', '06:00', 0)).toBe(8);
    expect(hoursFor('07:00', '07:00', 0)).toBeNull();
    expect(hoursLine('22:00', '06:30', 30)).toBe('8 h · overnight');
    expect(hoursLine('09:00', '13:30', 0)).toBe('4.5 h');
  });

  it('builds the body for POST /shifts', () => {
    expect(addShiftsBody(form(), word, site)).toEqual({
      body: { facilityId: 'f1', role: 'Cook', quantity: 2, startDate: '2026-11-10', endDate: '2026-11-12', weekdays: [2, 4], startTime: '07:00', endTime: '15:30', breakMinutes: 30 },
    });
    expect(addShiftsBody(form({ shiftCodeId: 'c', areaId: 'a', notes: '  Bring boots ', startTime: '', endTime: '' }), word, site)).toEqual({
      body: { facilityId: 'f1', role: 'Cook', quantity: 2, startDate: '2026-11-10', endDate: '2026-11-12', weekdays: [2, 4], areaId: 'a', shiftCodeId: 'c', notes: 'Bring boots' },
    });
    expect(addShiftsBody(form({ breakMinutes: '' }), word, site)).toMatchObject({ body: { breakMinutes: 0 } });
    expect(addShiftsBody(form({ facilityId: null }), word, site)).toEqual({ problem: 'Choose a site.' });
    expect(addShiftsBody(form({ role: '  ' }), word, site)).toEqual({ problem: 'Choose a role.' });
    expect(addShiftsBody(form({ days: [] }), word, site)).toEqual({ problem: 'Tick at least one day.' });
    expect(addShiftsBody(form({ startTime: 'x' }), word, site)).toEqual({ problem: 'Enter a start time, like 7:00 or 1530.' });
    expect(addShiftsBody(form({ endTime: '' }), word, site)).toEqual({ problem: 'Enter a finish time, like 15:30.' });
    expect(addShiftsBody(form({ endTime: '7:00' }), word, site)).toEqual({ problem: 'The start and finish times must be different.' });
    expect(addShiftsBody(form({ breakMinutes: '300' }), word, site)).toEqual({ problem: 'Enter the break in minutes, 0 to 240.' });
    expect(addShiftsBody(form({ startTime: '9', endTime: '10', breakMinutes: '60' }), { lower: 'job', lowerMany: 'jobs' }, site)).toEqual({ problem: 'The break is as long as the job.' });
  });

  it('words the button and the result', () => {
    expect(addCount(form())).toBe(4);
    expect(addLabel(4, word)).toBe('Add 4 shifts');
    expect(addLabel(1, word)).toBe('Add 1 shift');
    expect(addLabel(0, word)).toBe('Add shifts');
    expect(daysLine(['2026-11-09'])).toBe('Mon 9 Nov');
    expect(daysLine(['2026-11-10', '2026-11-09'])).toBe('Mon 9 and Tue 10 Nov');
    expect(daysLine(['2026-11-09', '2026-11-10', '2026-11-11'])).toBe('Mon 9, Tue 10 and Wed 11 Nov');
    expect(daysLine(['2026-11-30', '2026-12-01'])).toBe('Mon 30 Nov and Tue 1 Dec');
    expect(addedMessage(3, ['2026-11-09', '2026-11-10', '2026-11-11'], word)).toBe("Added 3 shifts: Mon 9, Tue 10 and Wed 11 Nov. They're open; fill them from the roster.");
    expect(addedMessage(1, ['2026-11-09'], { lower: 'job', lowerMany: 'jobs' })).toBe("Added 1 job: Mon 9 Nov. It's open; fill it from the roster.");
  });
});
