import { describe, expect, it } from 'vitest';
import { allocatable, countsLine, dayLine, joinable, listFilter, parseAreaList, parseProjectTab, projectLinks, statusBadge } from '../lib/projects';

describe('projects (David and Steve, 4 Nov)', () => {
  it('reads the tab and the list filter', () => {
    expect(parseProjectTab('team')).toBe('team');
    expect(parseProjectTab('nope')).toBe('overview');
    expect(parseProjectTab(undefined)).toBe('overview');
    expect(listFilter('archived')).toBe('archived');
    expect(listFilter('x')).toBe('live');
  });

  it('links to the screens CROP already has, narrowed to the project', () => {
    expect(projectLinks({ id: 'p1', clientId: 'c1', officeId: null }, '2026-11-02')).toEqual({
      roster: '/roster?site=p1&week=2026-11-02', template: '/roster/template?site=p1', allocations: '/allocations?clientId=c1', live: null,
    });
  });

  it('words a day and counts', () => {
    expect(dayLine({ rostered: 0, filled: 0, unfilled: 0 }, 'shifts')).toBe('Nothing rostered');
    expect(dayLine({ rostered: 12, filled: 10, unfilled: 2 }, 'shifts')).toBe('12 shifts · 10 filled · 2 unfilled');
    expect(dayLine({ rostered: 3, filled: 3, unfilled: 0 }, 'jobs')).toBe('3 jobs · 3 filled');
    expect(countsLine([[1, 'person', 'people'], [0, 'x', 'xs'], [3, 'item', 'items']])).toBe('1 person · 3 items');
    expect(statusBadge('on_hold')).toEqual(['On hold', 'warn']);
    expect(statusBadge(null)).toBeUndefined();
  });

  it('reads the work areas typed when adding a project', () => {
    expect(parseAreaList('Level 1\nLevel 2, level 1 ,  Car  park\n\n')).toEqual(['Level 1', 'Level 2', 'Car park']);
    expect(parseAreaList(null)).toEqual([]);
  });

  it('offers only equipment and people not already on the project', () => {
    expect(allocatable([{ id: 'a', status: 'active' }, { id: 'b', status: 'retired' }, { id: 'c', status: 'out_of_service' }, { id: 'd', status: 'active' }],
      [{ equipmentId: 'a', state: 'current' }, { equipmentId: 'd', state: 'ended' }]).map(e => e.id)).toEqual(['c', 'd']);
    expect(joinable([{ id: 'a', status: 'active' }, { id: 'b', status: 'applicant' }, { id: 'c', status: 'onboarding' }],
      [{ workerId: 'a', state: 'upcoming' }]).map(w => w.id)).toEqual(['c']);
  });
});
