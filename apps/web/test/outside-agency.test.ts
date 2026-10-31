import { describe, expect, it } from 'vitest';
import { UNCHECKED, addedMessage, uncheckedNote } from '../lib/outside-agency';

describe('people named by agencies not on CROP', () => {
  it('says plainly that CROP has not checked them', () => {
    expect(UNCHECKED).toBe('unchecked');
    expect(uncheckedNote('Northside Staffing')).toBe("Named by Northside Staffing, which isn't on CROP. CROP hasn't checked their credentials or right to work: Northside Staffing is responsible for that.");
    expect(addedMessage('Robin', 'Example', 'job')).toBe('Robin Example is booked on the job, marked as unchecked.');
  });
});
