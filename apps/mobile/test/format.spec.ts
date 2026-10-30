import { describe, expect, it } from 'vitest';
import { addDays, businessesOf, byDay, dayLabel, offerCloses, roleLine, timeRange } from '../src/format';

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
