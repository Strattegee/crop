import { describe, expect, it } from 'vitest';
import { canUse, limitLine } from '../lib/access';

describe('office access by role (4 Nov)', () => {
  it('lets supervisors use only their screens', () => {
    expect(canUse('allocator', 9000)).toBe(true);
    expect(canUse('supervisor', 2000)).toBe(true);
    expect(canUse('supervisor', 4200)).toBe(true);
    for (const code of [2200, 3100, 3200, 3500, 4000, 4100, 5000, 5500, 6000, 9000, 9190]) expect(canUse('supervisor', code)).toBe(false);
  });

  it('says which sites someone sees', () => {
    const w = { one: 'site', many: 'sites' };
    expect(limitLine(null, [], w)).toBeNull();
    expect(limitLine([], [], w)).toBe("You haven't been given any sites yet. Ask an owner or admin.");
    expect(limitLine(['a'], ['Alpha'], w)).toBe('You see 1 site: Alpha');
    expect(limitLine(['a', 'b', 'c'], ['C', 'Alpha', 'B'], w)).toBe('You see 3 sites: Alpha, B and C');
  });
});
