import { describe, expect, it } from 'vitest';
import {
  allocatable, clientProjectsLine, countsLine, dayLine, joinable, listFilter, NEW_PROJECT, newProjectDone, newProjectFrom, newProjectRetry, parseAreaList,
  parseProjectTab, projectLinks, siteChoices, statusBadge,
} from '../lib/projects';

describe('projects (David and Steve, 4 Nov)', () => {
  it('reads the tab and the list filter', () => {
    expect(parseProjectTab('team')).toBe('team');
    expect(parseProjectTab('stages')).toBe('stages');
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

describe('projects under clients (David, 5 Nov)', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  it('groups projects apart from sites in the roster picker, with the client', () => {
    const c = siteChoices([
      { id: 'b', name: 'Yard', kind: 'site', active: true },
      { id: 'p2', name: 'garden shed', kind: 'project', clientName: 'Example Homes', active: true },
      { id: 'p1', name: 'Beach Hut', kind: 'project', clientName: 'Example Homes', active: true },
      { id: 'p3', name: 'Old job', kind: 'project', active: false },
      { id: 'a', name: 'Depot', active: true },
    ]);
    expect(c.sites.map(s => s.name)).toEqual(['Depot', 'Yard']);
    expect(c.projects.map(s => s.name)).toEqual(['Beach Hut · Example Homes', 'garden shed · Example Homes']);
  });

  it('knows where a new project came from and where to go next', () => {
    const r = newProjectFrom('roster', '2026-11-09', null);
    expect(r).toEqual({ from: 'roster', week: '2026-11-09' });
    expect(newProjectDone(r, id)).toBe(`/roster?site=${id}&week=2026-11-09`);
    expect(newProjectRetry(r)).toBe(`/roster?site=${NEW_PROJECT}&week=2026-11-09`);
    expect(newProjectFrom('roster', 'nonsense', null)).toEqual({ from: 'roster', week: null });
    const c = newProjectFrom('client', null, id);
    expect(newProjectDone(c, 'p')).toBe('/projects/p');
    expect(newProjectRetry(c)).toBe(`/clients/${id}?newProject=1`);
    expect(newProjectFrom('client', null, 'x')).toEqual({ from: 'projects' });
    expect(newProjectRetry(newProjectFrom(undefined, null, null))).toBe('/projects?new=1');
  });

  it('words a client\'s projects', () => {
    expect(clientProjectsLine({ current: 0, archived: 0 }, 'Project', 'Projects')).toBe('No projects yet.');
    expect(clientProjectsLine({ current: 1, archived: 0 }, 'Project', 'Projects')).toBe('1 current project');
    expect(clientProjectsLine({ current: 2, archived: 1 }, 'Job', 'Jobs')).toBe('2 current jobs · 1 archived');
    expect(clientProjectsLine({ current: 0, archived: 3 }, 'Project', 'Projects')).toBe('No current projects · 3 archived');
  });
});
