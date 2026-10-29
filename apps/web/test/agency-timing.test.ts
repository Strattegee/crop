import { describe, expect, it } from 'vitest';
import { minutesWords, requestStepChoices, stepChoices } from '../lib/agency-timing';

describe('agency fill timing', () => {
  it('says minutes in words', () => {
    expect([5, 60, 90, 120, 1440].map(minutesWords)).toEqual(['5 minutes', '1 hour', '1 hour 30 minutes', '2 hours', '1 day']);
  });

  it('keeps an unusual current value among the choices', () => {
    expect(stepChoices([10, 30], 10).map(c => c.value)).toEqual([10, 30]);
    expect(stepChoices([10, 30], 25)).toEqual([{ value: 10, label: '10 minutes' }, { value: 25, label: '25 minutes' }, { value: 30, label: '30 minutes' }]);
  });

  it('offers the business’s usual gap first on the shift panel', () => {
    const c = requestStepChoices(45);
    expect(c[0]).toEqual({ value: '', label: '45 minutes (your usual)' });
    expect(c.map(x => x.value)).toEqual(['', '5', '10', '15', '30', '60', '120', '240']);
  });
});
