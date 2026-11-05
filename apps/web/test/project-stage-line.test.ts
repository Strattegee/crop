import { describe, expect, it } from 'vitest';
import { projectStageLine, projectStagesHref } from '../app/(office)/roster/view';
import { matchesSearch, type ListShift } from '../lib/roster-list';

describe('project stage line on roster cards', () => {
  it('names the stage a stage rostering made the shift for', () => {
    expect(projectStageLine({ projectStageId: 's1', projectStageName: 'Demolition' })).toBe('Stage: Demolition');
  });
  it('says project supervisor for the supervisor\'s daily shift, even when a stage is set', () => {
    expect(projectStageLine({ projectSupervisor: true })).toBe('Project supervisor');
    expect(projectStageLine({ projectSupervisor: true, projectStageId: 's1', projectStageName: 'Build' })).toBe('Project supervisor');
  });
  it('shows nothing for ordinary shifts or a stage that can no longer be seen', () => {
    expect(projectStageLine({})).toBeNull();
    expect(projectStageLine({ projectStageId: null, projectStageName: null, projectSupervisor: false })).toBeNull();
    expect(projectStageLine({ projectStageId: 's1', projectStageName: null })).toBeNull();
    expect(projectStageLine({ projectStageId: 's1', projectStageName: '  ' })).toBeNull();
  });
  it('links to the project\'s Stages tab', () => {
    expect(projectStagesHref('abc')).toBe('/projects/abc?tab=stages');
  });
  it('lets the list search find shifts by stage name', () => {
    const s: ListShift = {
      id: '1', facilityId: 'f', facilityName: 'Example Street build', areaName: null, role: 'Carpenter', status: 'open',
      localDate: '2026-11-09', localStart: '07:00', localEnd: '15:30', hours: 8, workerId: null, workerName: null,
      projectStageName: 'Demolition and make good',
    };
    expect(matchesSearch(s, 'demolition carpenter')).toBe(true);
    expect(matchesSearch({ ...s, projectStageName: null }, 'demolition')).toBe(false);
  });
});
