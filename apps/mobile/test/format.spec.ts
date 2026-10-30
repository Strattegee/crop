import { describe, expect, it } from 'vitest';
import {
  addDays, businessesOf, byDay, chipOn, dayLabel, leaveAskedMessage, leaveDates, offerCloses, patternBody, periodsLabel, roleLine, timeRange, toggleDay,
} from '../src/format';

describe('worker app formatting', () => {
  it('names days plainly', () => {
    expect(dayLabel('2026-11-02')).toBe('Mon 2 Nov');
    expect(dayLabel('2026-11-02', '2026-11-02')).toBe('Today');
    expect(dayLabel('2026-11-03', '2026-11-02')).toBe('Tomorrow');
    expect(dayLabel('2026-11-04', '2026-11-02')).toBe('Wed 4 Nov');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('groups shifts by day in order', () => {
    const g = byDay([{ id: 'a', date: '2026-11-02' }, { id: 'b', date: '2026-11-02' }, { id: 'c', date: '2026-11-04' }]);
    expect(g.map(d => [d.date, d.shifts.map(s => s.id)])).toEqual([['2026-11-02', ['a', 'b']], ['2026-11-04', ['c']]]);
  });

  it('words times, roles and offer closing times', () => {
    expect(timeRange({ start: '07:00', end: '15:30', breakMinutes: 30 })).toBe('07:00–15:30 (30 min break)');
    expect(timeRange({ start: '22:00', end: '06:00', breakMinutes: 0 })).toBe('22:00–06:00');
    expect(roleLine({ role: 'Chef', area: 'Kitchen' })).toBe('Chef · Kitchen');
    expect(roleLine({ role: 'Chef', area: null })).toBe('Chef');
    const now = new Date('2026-11-01T00:00:00Z');
    expect(offerCloses(null, now)).toBeNull();
    expect(offerCloses('2026-11-01T00:20:00Z', now)).toBe('Closes in 20 min');
    expect(offerCloses('2026-11-01T01:30:00Z', now)).toBe('Closes in 1 hour');
    expect(offerCloses('2026-11-03T00:00:00Z', now)).toBe('Closes in 2 days');
    expect(offerCloses('2026-10-31T00:00:00Z', now)).toBe('Closed');
  });

  it('lists the businesses from /me', () => {
    expect(businessesOf({ memberships: [{ tenantSlug: 'cafe', tenantName: 'Demo Cafe', role: 'worker' }] })).toEqual([{ slug: 'cafe', name: 'Demo Cafe' }]);
  });
});

describe('availability and leave in the app', () => {
  it('words a day plainly', () => {
    expect(periodsLabel(undefined)).toBe('Not said');
    expect(periodsLabel([])).toBe('Not available');
    expect(periodsLabel(['night', 'am'])).toBe('AM, Night');
    expect(periodsLabel(['am', 'pm', 'night'])).toBe('Any time');
  });

  it('switches parts of a day on and off', () => {
    expect(toggleDay(undefined, 'pm')).toEqual(['pm']);
    expect(toggleDay(['pm'], 'am')).toEqual(['am', 'pm']);
    expect(toggleDay(['pm'], 'pm')).toEqual([]);
    expect(toggleDay(['am', 'pm'], 'off')).toEqual([]);
    expect(toggleDay([], 'off')).toBeUndefined();
    expect(chipOn([], 'off')).toBe(true);
    expect(chipOn(undefined, 'off')).toBe(false);
    expect(chipOn(['am'], 'am')).toBe(true);
  });

  it('sends only the days with something said', () => {
    expect(patternBody({ 1: [], 3: ['am'], 5: undefined })).toEqual({ days: [{ weekday: 1, periods: [] }, { weekday: 3, periods: ['am'] }] });
  });

  it('words leave', () => {
    expect(leaveDates({ startsOn: '2026-11-02', endsOn: '2026-11-02' })).toBe('Mon 2 Nov');
    expect(leaveDates({ startsOn: '2026-11-02', endsOn: '2026-11-04' })).toBe('Mon 2 Nov – Wed 4 Nov (3 days)');
    expect(leaveAskedMessage(0, { lower: 'shift', lowerMany: 'shifts' })).toBe('The office will let you know once it has been decided.');
    expect(leaveAskedMessage(2, { lower: 'job', lowerMany: 'jobs' })).toBe("You're on 2 jobs in those days. The office will let you know once it has been decided.");
  });
});
