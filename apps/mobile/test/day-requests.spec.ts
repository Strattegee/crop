import { describe, expect, it } from 'vitest';
import { kindLabel, requestBody, requestProblem, stepTime, TIMES } from '../src/day-requests';

describe('requests for a day in the app', () => {
  it('labels choices with the business word for a shift', () => {
    expect(kindLabel('prefer_am', { lower: 'job' })).toBe('AM job');
    expect(kindLabel('finish_by', { lower: 'shift' })).toBe('Finish by');
  });

  it('steps times in half hours within the day', () => {
    expect(TIMES[0]).toBe('05:00');
    expect(TIMES[TIMES.length - 1]).toBe('23:30');
    expect(stepTime('14:00', 1)).toBe('14:30');
    expect(stepTime('05:00', -1)).toBe('05:00');
    expect(stepTime('nope', 1)).toBe('14:30');
  });

  it('checks and builds the request', () => {
    expect(requestProblem('other', '  ')).toBe('Say what you would like');
    expect(requestProblem('prefer_am', '')).toBeNull();
    expect(requestBody('2026-11-09', 'finish_by', '14:00', ' School pick-up ')).toEqual({ date: '2026-11-09', kind: 'finish_by', time: '14:00', note: 'School pick-up' });
    expect(requestBody('2026-11-09', 'prefer_pm', '14:00', '')).toEqual({ date: '2026-11-09', kind: 'prefer_pm', time: null, note: null });
  });
});
