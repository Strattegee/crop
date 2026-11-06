import { describe, expect, it } from 'vitest';
import { clock, phonesNote, QUIET_CHOICES, quietChoice, quietNote } from '../src/alerts';
import { managerTab, tapTarget } from '../src/push-rules';

describe('phone alerts in manager mode', () => {
  it('matches quiet hours to a choice', () => {
    expect(quietChoice({ quietFrom: '22:00', quietUntil: '06:00' })).toBe('22-06');
    expect(quietChoice({ quietFrom: null, quietUntil: null })).toBe('off');
    expect(quietChoice({ quietFrom: '20:15', quietUntil: '06:00' })).toBeNull();
    expect(new Set(QUIET_CHOICES.map(c => c.key)).size).toBe(QUIET_CHOICES.length);
  });

  it('says the times plainly, in the business time zone and words', () => {
    expect(clock('22:00')).toBe('10pm');
    expect(clock('06:30')).toBe('6:30am');
    expect(clock('00:00')).toBe('12am');
    expect(clock('12:00')).toBe('12pm');
    expect(quietNote({ quietFrom: '22:00', quietUntil: '06:00', timezone: 'Pacific/Auckland' }, 'jobs'))
      .toBe('From 10pm to 6am (Auckland time) alerts wait until quiet hours end; jobs starting soon are only sent then if they still need someone.');
    expect(quietNote({ quietFrom: null, quietUntil: null, timezone: 'Australia/Melbourne' })).toBe('Alerts come at any time of day.');
    expect(phonesNote(1)).toBeNull();
    expect(phonesNote(0)).toMatch(/Allow notifications/);
  });

  it('opens the manager side for office alerts', () => {
    expect(tapTarget({ tenant: 'cafe', screen: 'attention' }, ['cafe'])).toEqual({ tenant: 'cafe', screen: 'attention' });
    expect(tapTarget({ tenant: 'cafe', screen: 'requests' }, ['cafe'])).toEqual({ tenant: 'cafe', screen: 'requests' });
    expect(managerTab('attention')).toBe('today');
    expect(managerTab('requests')).toBe('requests');
    expect(managerTab('offers')).toBeNull();
    expect(managerTab(null)).toBeNull();
  });
});
