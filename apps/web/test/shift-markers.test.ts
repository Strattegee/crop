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
