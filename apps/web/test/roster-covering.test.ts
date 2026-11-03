import { describe, expect, it } from 'vitest';
import { coveringChoices, coveringLine, shiftMarkers, tLines, usualChoices } from '../app/(office)/roster/view';

describe('covering line (Steve\'s "T" line)', () => {
  const people = [{ id: 'z', name: 'Zoe Example' }, { id: 'a', name: 'Ana Example' }, { id: 'b', name: 'Ben Example' }, { id: 'c', name: 'Cat Example' }];
  const leave = [
    { workerId: 'z', status: 'requested' as const, startsOn: '2026-11-02', endsOn: '2026-11-04' },
    { workerId: 'c', status: 'approved' as const, startsOn: '2026-11-03', endsOn: '2026-11-03' },
    { workerId: 'b', status: 'approved' as const, startsOn: '2026-11-10', endsOn: '2026-11-12' },
  ];

  it('says who is covered, never why', () => {
    expect(coveringLine('Ana Example')).toBe('Covering Ana Example');
  });

  it('lists people on leave that day first, then everyone else, leaving out the person working it', () => {
    const r = coveringChoices(people, leave, '2026-11-03', { id: null, name: null }, 'a');
    expect(r.map(c => c.label)).toEqual(['Cat Example · on leave', 'Zoe Example · leave requested', 'Ben Example']);
    expect(r.map(c => c.away)).toEqual([true, true, false]);
  });

  it('leave outside the date does not count', () => {
    expect(coveringChoices(people, leave, '2026-11-05', { id: null, name: null }, null).every(c => !c.away)).toBe(true);
  });

  it('keeps the person currently covered even when they are no longer on the roster', () => {
    const r = coveringChoices(people, [], '2026-11-03', { id: 'gone', name: 'Gus Example' }, null);
    expect(r.map(c => c.id)).toContain('gone');
  });
});

describe('the T line: who usually works a shift (David, 3 Nov)', () => {
  const usual = { usualWorkerId: 's', usualName: 'Sandra Example' };

  it('names the usual person, greyed when they are the one working it', () => {
    expect(tLines({ ...usual, workerId: 's' })).toEqual([{ text: 'Sandra Example', title: 'Usually worked by Sandra Example (on it)', tone: 'same' }]);
    expect(tLines({ ...usual, workerId: 'g' })[0]).toMatchObject({ text: 'Sandra Example', tone: 'usual' });
    expect(tLines({ ...usual, workerId: null })[0].tone).toBe('usual');
  });

  it('says when they are away that day, never the kind of leave', () => {
    expect(tLines({ ...usual, workerId: 'g', usualAway: 'on_leave' })[0]).toMatchObject({ text: 'Sandra Example – On leave', tone: 'away' });
    expect(tLines({ ...usual, usualAway: 'leave_requested' })[0].text).toBe('Sandra Example – Leave requested');
    expect(tLines({ ...usual, usualAway: 'not_available' })[0].text).toBe('Sandra Example – Not available');
  });

  it('shows the covering line only when it names someone else', () => {
    expect(tLines({ ...usual, usualAway: 'on_leave', coveringWorkerId: 's', coveringName: 'Sandra Example' }).map(l => l.text)).toEqual(['Sandra Example – On leave']);
    expect(tLines({ ...usual, coveringWorkerId: 'k', coveringName: 'Kim Example' }).map(l => l.text)).toEqual(['Sandra Example', 'Covering Kim Example']);
    expect(tLines({ coveringWorkerId: 'k', coveringName: 'Kim Example' })).toEqual([{ text: 'Covering Kim Example', title: 'Covering Kim Example', tone: 'covering' }]);
    expect(tLines({})).toEqual([]);
  });

  it('adds a T marker, ringed when the usual person is away', () => {
    expect(shiftMarkers({ ...usual, workerId: 's' }).map(m => [m.letter, m.cls])).toEqual([['T', 'mk-t']]);
    expect(shiftMarkers({ ...usual, usualAway: 'on_leave' }).find(m => m.key === 't')).toMatchObject({ cls: 'mk-t warn', title: 'Usually worked by Sandra Example (on leave that day)' });
    expect(shiftMarkers({}).find(m => m.key === 't')).toBeUndefined();
  });

  it('offers everyone by name for the usual person, keeping the current one', () => {
    expect(usualChoices([{ id: 'b', name: 'Ben' }, { id: 'a', name: 'Ana' }], { id: 'x', name: 'Xen (left)' }).map(c => c.label)).toEqual(['Ana', 'Ben', 'Xen (left)']);
  });
});
