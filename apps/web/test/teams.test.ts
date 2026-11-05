import { describe, expect, it } from 'vitest';
import { awayLine, awayWords, makeUpFromForm, namedLine, pickerGroups, splitPick, teamFilter } from '../lib/teams';

describe('standing teams (David, 5 Nov)', () => {
  it('reads the make-up form', () => {
    const f: Record<string, string> = { role_0: 'Carpenter', count_0: '2', role_1: '', count_1: '3', role_2: 'Painter', count_2: '', role_3: 'Carpenter', count_3: '1', role_4: 'Cleaner', count_4: '0' };
    expect(makeUpFromForm(k => f[k], 5)).toEqual([{ role: 'Carpenter', count: 3 }, { role: 'Painter', count: 1 }]);
    expect(makeUpFromForm(k => ({ role_0: 'Carpenter', count_0: '1.5' } as Record<string, string>)[k], 1)).toEqual({ problem: 'How many Carpenter: a whole number from 1 to 99' });
    expect(makeUpFromForm(() => undefined, 3)).toEqual([]);
  });

  it('words who is named and who is away', () => {
    expect(namedLine({ needed: 7, counts: { current: 3, upcoming: 0 } })).toBe('3 of 7 named');
    expect(namedLine({ needed: 0, counts: { current: 2, upcoming: 1 } })).toBe('2 named · 1 starting later');
    expect(namedLine({ needed: 4, counts: { current: 0, upcoming: 0 } })).toBe('No one yet');
    expect(awayLine({ awayToday: [{ workerId: 'c', name: 'Cy Example', role: 'Plasterer', away: 'on_leave' }, { workerId: 'd', name: 'Dee', role: 'Painter', away: 'not_active' }] }))
      .toBe('Away today: Cy Example (Plasterer)');
    expect(awayLine({ awayToday: [] })).toBeNull();
    expect(awayWords('not_active')).toBe('No longer active');
    expect(awayWords(null)).toBeNull();
  });

  it('offers only people with the role, make-up roles first', () => {
    const team = {
      roles: [{ role: 'Plasterer', count: 2 }, { role: 'Carpenter', count: 1 }],
      gaps: [{ role: 'Plasterer', needed: 2, named: 1, short: 1, shortToday: 1 }],
      members: [{ workerId: 'cy' }] as never[],
    };
    const people = [
      { id: 'ana', name: 'Ana Example', roles: ['Carpenter'] },
      { id: 'ben', name: 'Ben Example', roles: ['Painter', 'Plasterer'] },
      { id: 'cy', name: 'Cy Example', roles: ['Plasterer'] },
    ];
    expect(pickerGroups(team, people)).toEqual([
      { role: 'Plasterer', label: 'Plasterer (short 1)', options: [{ value: 'ben|Plasterer', label: 'Ben Example' }] },
      { role: 'Carpenter', label: 'Carpenter', options: [{ value: 'ana|Carpenter', label: 'Ana Example' }] },
      { role: 'Painter', label: 'Painter (not in the make-up)', options: [{ value: 'ben|Painter', label: 'Ben Example' }] },
    ]);
    expect(splitPick('ben|Plasterer')).toEqual({ workerId: 'ben', role: 'Plasterer' });
    expect(splitPick('ben|Fire | safety')).toEqual({ workerId: 'ben', role: 'Fire | safety' });
    expect(splitPick('ben')).toBeNull();
    expect(splitPick(undefined)).toBeNull();
    expect(teamFilter('archived')).toBe('archived');
    expect(teamFilter('x')).toBe('live');
  });
});
