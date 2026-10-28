import { describe, expect, it } from 'vitest';
import { coveringChoices, coveringLine } from '../app/(office)/roster/view';

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
