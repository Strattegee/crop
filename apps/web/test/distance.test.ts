import { describe, expect, it } from 'vitest';
import { distanceWords } from '../lib/distance';

describe('distance words (keep in step with the API)', () => {
  it('words distances plainly', () => {
    expect(distanceWords(0)).toBe('<1 km');
    expect(distanceWords(0.99)).toBe('<1 km');
    expect(distanceWords(12.4)).toBe('12 km');
    expect(distanceWords(139.6)).toBe('140 km');
    expect(distanceWords(1250)).toBe('1,250 km');
    expect(distanceWords(null)).toBeNull();
    expect(distanceWords(undefined)).toBeNull();
  });
});
