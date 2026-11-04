import { describe, expect, it } from 'vitest';
import { distanceWords, homeWords } from '../lib/distance';

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

describe('distance for the person on their offer (David, 4 Nov)', () => {
  it('says how far from home, only when known', () => {
    expect(homeWords(12.4)).toBe('About 12 km from home');
    expect(homeWords(0.2)).toBe('Under 1 km from home');
    expect(homeWords(null)).toBeNull();
    expect(homeWords(undefined)).toBeNull();
  });
});
