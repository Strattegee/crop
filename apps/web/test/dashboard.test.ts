import { describe, expect, it } from 'vitest';
import { barWidth, showValue, standingClass, targetLine } from '../lib/dashboard';

describe('dashboard wording', () => {
  it('shows values in their unit', () => {
    expect(showValue(null, 'percent')).toBe('–');
    expect(showValue(92.5, 'percent')).toBe('92.5%');
    expect(showValue(3, 'count')).toBe('3');
    expect(showValue(1, 'days')).toBe('1 day');
    expect(showValue(4.5, 'hours')).toBe('4.5 hours');
  });
  it('says what the target is, or that none is set', () => {
    expect(targetLine({ target: null, suggested: 95, unit: 'percent', better: 'higher' })).toBe('No target set (suggested: at least 95%)');
    expect(targetLine({ target: 90, suggested: 95, unit: 'percent', better: 'higher' })).toBe('Target: at least 90%');
    expect(targetLine({ target: 0, suggested: 0, unit: 'count', better: 'lower' })).toBe('Target: 0');
    expect(targetLine({ target: 48, suggested: 48, unit: 'hours', better: 'lower' })).toBe('Target: at most 48 hours');
  });
  it('colours only what is off target', () => {
    expect(standingClass('off_target')).toBe('kpi off');
    expect(standingClass('no_target')).toBe('kpi');
  });
  it('sizes funnel bars', () => {
    expect(barWidth(0, 10)).toBe(0);
    expect(barWidth(10, 10)).toBe(100);
    expect(barWidth(1, 100)).toBe(4);
    expect(barWidth(3, 0)).toBe(0);
  });
});
