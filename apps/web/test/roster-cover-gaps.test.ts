import { describe, expect, it } from 'vitest';
import { barPosition, dayWindow, gapBars, gapsByDay, lanes } from '../app/(office)/roster/view';

const gap = (o: Partial<Parameters<typeof gapBars>[0][number]> = {}) => ({
  facilityId: 'f1', facilityName: 'Demo Cafe', typeName: 'RSA', localDate: '2026-11-06', localFrom: '17:00', localTo: '22:00',
  shiftId: 's1', title: 'Nobody with an RSA working 17:00–22:00', ...o,
});

describe('gapBars', () => {
  it('puts a gap on the day it starts, at its local times', () => {
    const [b] = gapBars([gap()], '2026-11-06', false);
    expect(b).toMatchObject({ localStart: '17:00', localEnd: '22:00', shiftId: 's1', label: 'No RSA' });
    expect(b.title).toBe('Nobody with an RSA working 17:00–22:00');
  });

  it('leaves out gaps on other days', () => {
    expect(gapBars([gap({ localDate: '2026-11-05' })], '2026-11-06', false)).toEqual([]);
  });

  it('an overnight gap runs past midnight on its first day and shows from midnight the next', () => {
    const g = gap({ localFrom: '22:00', localTo: '02:00 next day' });
    const [first] = gapBars([g], '2026-11-06', false);
    expect(first).toMatchObject({ localStart: '22:00', localEnd: '02:00' });
    const w = dayWindow([{ localStart: '18:00', localEnd: '02:00' }]);
    expect(barPosition(first, w).left).toBeGreaterThan(0);
    const [second] = gapBars([g], '2026-11-07', false);
    expect(second).toMatchObject({ localStart: '00:00', localEnd: '02:00' });
  });

  it('a gap ending exactly at midnight shows nothing the next day', () => {
    expect(gapBars([gap({ localFrom: '20:00', localTo: '00:00 next day' })], '2026-11-07', false)).toEqual([]);
  });

  it('names the site when every site is shown', () => {
    const [b] = gapBars([gap()], '2026-11-06', true);
    expect(b.label).toBe('No RSA · Demo Cafe');
    expect(b.title).toContain('· Demo Cafe');
  });

  it('overlapping gaps take separate lanes', () => {
    const bars = gapBars([gap(), gap({ typeName: 'First aid', localFrom: '18:00', localTo: '20:00' })], '2026-11-06', false);
    expect(new Set(bars.map(b => b.id)).size).toBe(2);
    expect(lanes(bars).count).toBe(2);
  });
});

describe('gapsByDay', () => {
  it('counts gaps by the day they start', () => {
    const m = gapsByDay([gap(), gap({ typeName: 'First aid' }), gap({ localDate: '2026-11-07' })]);
    expect(m.get('2026-11-06')).toBe(2);
    expect(m.get('2026-11-07')).toBe(1);
  });
});
