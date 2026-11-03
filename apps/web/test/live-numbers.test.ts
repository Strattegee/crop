import { describe, expect, it } from 'vitest';
import { liveHref, liveQuery, parseLiveParams, percentLine, periodDates, scopeLine } from '../lib/live-numbers';

const OFFICE = '6f1c1f8e-0b6a-4a51-9a51-1b2c3d4e5f60';

describe('live numbers page (David, 3 Nov)', () => {
  it('keeps period, state and office in the URL, short', () => {
    expect(parseLiveParams({})).toEqual({ period: 'week', state: null, office: null });
    const p = parseLiveParams({ period: 'month', state: 'VIC', office: OFFICE.toUpperCase() });
    expect(p).toEqual({ period: 'month', state: 'VIC', office: OFFICE });
    expect(parseLiveParams({ period: 'year', office: 'Metro' })).toEqual({ period: 'week', state: null, office: null });
    expect(parseLiveParams({ office: 'none' }).office).toBe('none');
    expect(liveHref(p)).toBe(`/dashboard/live?period=month&state=VIC&office=${OFFICE}`);
    expect(liveHref(p, { state: null, office: null, period: 'week' })).toBe('/dashboard/live');
    expect(liveQuery(parseLiveParams({}))).toBe('period=week');
    expect(liveQuery(p)).toBe(`period=month&state=VIC&office=${OFFICE}`);
  });

  it('words percentages, the scope and the dates', () => {
    expect(percentLine({ percent: 37.5 }, 'requests')).toBe('37.5% of requests');
    expect(percentLine({ percent: null }, 'requests')).toBeNull();
    expect(scopeLine({ state: null, office: null, officeName: null })).toBe('Whole business');
    expect(scopeLine({ state: 'VIC', office: OFFICE, officeName: 'VIC Melbourne Metro' })).toBe('VIC › VIC Melbourne Metro');
    expect(scopeLine({ state: null, office: 'none', officeName: null })).toBe('No office');
    expect(periodDates('2026-11-03', '2026-11-03')).toBe('Tue 3 Nov');
    expect(periodDates('2026-11-02', '2026-11-08')).toBe('2–8 Nov');
    expect(periodDates('2026-10-28', '2026-11-03')).toBe('28 Oct – 3 Nov');
  });
});
