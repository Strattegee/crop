import { describe, expect, it } from 'vitest';
import { T, makeWords } from '../lib/term-words';

describe("the business's words", () => {
  const term = (code: number, singular: string, plural: string) =>
    ({ code, key: '', concept: '', singular, plural, defaultSingular: '', defaultPlural: '' });

  it('uses the words the business chose and falls back to the defaults', () => {
    const tw = makeWords([term(T.worker, 'Staff member', 'Staff'), term(T.site, 'Venue', 'Venues')]);
    expect(tw.one(T.worker)).toBe('Staff member');
    expect(tw.many(T.site)).toBe('Venues');
    expect(tw.one(T.area)).toBe('Area');
    expect(tw.lower(T.site, true)).toBe('venues');
  });

  it('counts in those words', () => {
    const tw = makeWords([term(T.shift, 'Job', 'Jobs')]);
    expect(tw.count(1, T.shift)).toBe('1 job');
    expect(tw.count(0, T.shift)).toBe('0 jobs');
    expect(tw.count(3, T.equipment)).toBe('3 equipment');
  });

  it('ignores a blank word', () => {
    expect(makeWords([term(T.area, '', '')]).one(T.area)).toBe('Area');
  });
});
