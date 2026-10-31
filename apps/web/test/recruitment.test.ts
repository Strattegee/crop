import { describe, expect, it } from 'vitest';
import { daysLine, dropMove, historyLine, nextStage, previousStage, recruitmentState } from '../lib/recruitment';

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

describe('recruitment history and drag and drop', () => {
  it('words each move in plain English', () => {
    expect(historyLine({ toStage: 'applied', fromStage: null })).toBe('Applied');
    expect(historyLine({ toStage: 'applied', fromStage: 'interview' })).toBe('Moved back to Applied');
    expect(historyLine({ toStage: 'interview', fromStage: 'screening' })).toBe('Moved to Interview');
    expect(historyLine({ toStage: 'offer', fromStage: 'applied' })).toBe('Moved to Offer');
    expect(historyLine({ toStage: 'screening', fromStage: 'offer' })).toBe('Moved back to Screening');
    expect(historyLine({ toStage: 'not_proceeding', fromStage: 'interview' })).toBe('Not proceeding (was at Interview)');
    expect(historyLine({ toStage: 'reopened', fromStage: null })).toBe('Reopened');
    expect(historyLine({ toStage: 'onboarding', fromStage: 'offer' })).toBe('Onboarding started');
    expect(historyLine({ toStage: 'started', fromStage: 'onboarding' })).toBe('Onboarding finished: started work');
  });
  it('says where someone is in recruitment', () => {
    expect(recruitmentState('applicant', null, [])).toBe('Applied');
    expect(recruitmentState('applicant', 'offer', [{ toStage: 'offer' }])).toBe('Offer');
    expect(recruitmentState('onboarding', 'offer', [{ toStage: 'onboarding' }])).toBe('Onboarding');
    expect(recruitmentState('inactive', 'interview', [{ toStage: 'applied' }, { toStage: 'not_proceeding' }])).toBe('Not proceeding');
    expect(recruitmentState('active', 'offer', [{ toStage: 'onboarding' }, { toStage: 'started' }])).toBe('Started');
    expect(recruitmentState('active', null, [])).toBeNull();
    expect(recruitmentState('onboarding', null, [])).toBeNull();
  });
  it('turns a drop into a move only between the four stages', () => {
    expect(dropMove('applied', 'interview')).toEqual({ stage: 'interview', label: 'Moved to Interview.' });
    expect(dropMove('offer', 'screening')).toEqual({ stage: 'screening', label: 'Moved back to Screening.' });
    expect(dropMove('applied', 'applied')).toBeNull();
    expect(dropMove('offer', 'onboarding')).toBeNull();
    expect(dropMove('onboarding', 'offer')).toBeNull();
    expect(dropMove('started', 'applied')).toBeNull();
  });
});
