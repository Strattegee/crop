import { describe, expect, it } from 'vitest';
import { daysLine, nextStage, previousStage } from '../lib/recruitment';

describe('recruitment board wording (David, 31 Oct)', () => {
  it('steps forward and back through the stages', () => {
    expect(nextStage('applied')?.label).toBe('Screening');
    expect(nextStage('offer')).toBeNull();
    expect(previousStage('applied')).toBeNull();
    expect(previousStage('interview')?.label).toBe('Screening');
    expect(nextStage('onboarding')).toBeNull();
  });
  it('says how long someone has been where they are', () => {
    expect(daysLine('screening', 0)).toBe('Moved here today');
    expect(daysLine('screening', 1)).toBe('1 day at this stage');
    expect(daysLine('onboarding', 5)).toBe('Onboarding for 5 days');
    expect(daysLine('started', 2)).toBe('Started 2 days ago');
    expect(daysLine('applied', null)).toBe('');
  });
});
