import { describe, expect, it } from 'vitest';
import { shiftMarkers } from '../app/(office)/roster/view';

const letters = (s: Parameters<typeof shiftMarkers>[0]) => shiftMarkers(s).map(m => `${m.letter}${m.cls.includes('warn') ? '!' : ''}`).join(' ');

describe('shift marker letters (David, 30 Oct)', () => {
  it('shows the gender requested, marked when the person on it is recorded otherwise or not at all', () => {
    expect(letters({ genderRequested: 'F' })).toBe('F');
    expect(letters({ genderRequested: 'F', workerId: 'a', workerGender: 'F' })).toBe('F');
    expect(letters({ genderRequested: 'F', workerId: 'b', workerName: 'Ben Example', workerGender: 'M' })).toBe('F!');
    expect(shiftMarkers({ genderRequested: 'F', workerId: 'b', workerName: 'Ben Example', workerGender: 'M' })[0].title)
      .toBe('Female worker requested; Ben Example is recorded as male');
    expect(shiftMarkers({ genderRequested: 'M', workerId: 'c', workerName: 'Cal Example', workerGender: null })[0].title)
      .toBe("Male worker requested; Cal Example's gender isn't recorded");
  });
  it("shows the person's own gender when nothing was requested, and nothing for an empty shift", () => {
    expect(letters({ workerId: 'a', workerName: 'Ana Example', workerGender: 'F' })).toBe('F');
    expect(letters({ workerId: 'c', workerGender: null })).toBe('');
    expect(letters({})).toBe('');
  });
  it('adds V, E, I and D for vehicles, other equipment, items and duties', () => {
    const s = {
      equipment: [{ name: 'Ute 1', vehicle: true }, { name: 'Trailer 2', vehicle: true }, { name: 'Generator' }],
      itemCount: 2, duties: [{ name: 'Serves alcohol' }],
    };
    expect(letters(s)).toBe('V E I D');
    expect(shiftMarkers(s).find(m => m.letter === 'V')!.title).toBe('Vehicle: Ute 1, Trailer 2');
    expect(shiftMarkers({ itemCount: 1 })[0].title).toBe('1 item given out or used');
  });
});

describe('customised letters (David, 3 Nov)', () => {
  it('uses the business letters, keeping F/M for gender', async () => {
    const { shiftMarkers } = await import('../app/(office)/roster/view');
    const { lettersOf } = await import('../lib/marker-letters');
    const letters = lettersOf({ duty: 'CI', vehicle: 'C', template: 'U' });
    const m = shiftMarkers({
      genderRequested: 'F', equipment: [{ name: 'Van', vehicle: true }, { name: 'Laptop' }], duties: [{ name: 'Care' }], itemCount: 1,
      usualWorkerId: 'u', usualName: 'Sandra Example',
    }, letters);
    expect(m.map(x => x.letter)).toEqual(['F', 'C', 'E', 'I', 'CI', 'U']);
    expect(lettersOf(undefined)).toEqual({ duty: 'D', vehicle: 'V', equipment: 'E', items: 'I', template: 'T', request: 'R' });
  });
});

describe('R: requests for a day from the app (David, 3 Nov)', () => {
  it('finds the person on a shift\'s requests that day and marks the ones the shift breaks', async () => {
    const { requestsFor, breaksRequest, shiftMarkers } = await import('../app/(office)/roster/view');
    const reqs = [
      { id: '1', workerId: 'a', date: '2026-11-09', kind: 'prefer_am', atTime: null, note: null, status: 'open', line: 'AM shift please' },
      { id: '2', workerId: 'a', date: '2026-11-09', kind: 'finish_by', atTime: '14:00', note: null, status: 'open', line: 'Finish by 14:00' },
      { id: '3', workerId: 'b', date: '2026-11-09', kind: 'prefer_pm', atTime: null, note: null, status: 'open', line: 'PM shift please' },
    ];
    const s = { workerId: 'a', localDate: '2026-11-09', localStart: '07:00', localEnd: '15:00' };
    expect(requestsFor(s, reqs).map(r => [r.id, r.breaks])).toEqual([['1', false], ['2', true]]);
    expect(requestsFor({ ...s, workerId: null }, reqs)).toEqual([]);
    expect(breaksRequest({ kind: 'prefer_night', atTime: null }, '22:00', '06:00')).toBe(false);
    expect(breaksRequest({ kind: 'start_after', atTime: '10:00' }, '09:00', '17:00')).toBe(true);
    expect(breaksRequest({ kind: 'other', atTime: null }, '09:00', '17:00')).toBe(false);
    const m = shiftMarkers({ requests: requestsFor(s, reqs) }).find(x => x.key === 'r')!;
    expect(m).toMatchObject({ letter: 'R', cls: 'mk-r warn', title: "Asked: AM shift please; Finish by 14:00 (this doesn't fit)" });
    expect(shiftMarkers({ requests: [] }).find(x => x.key === 'r')).toBeUndefined();
  });
});
