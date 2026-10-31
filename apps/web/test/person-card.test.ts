import { describe, expect, it } from 'vitest';
import { avatarColour, badgeList, displayName, expiryLine, hoursLine, initials } from '../lib/person-card';
import { personTabs } from '../lib/person-tabs';

describe('employee card wording (David, 31 Oct)', () => {
  const p = { firstName: 'Katherine', lastName: 'Example', preferredName: 'Kate' };
  it('uses the preferred name and its initials', () => {
    expect(displayName(p)).toBe('Kate Example');
    expect(initials(p)).toBe('KE');
    expect(initials({ ...p, preferredName: null })).toBe('KE');
  });
  it('gives each person a steady colour', () => {
    expect(avatarColour('abc')).toBe(avatarColour('abc'));
  });
  it('shows hours against the contract, or alone', () => {
    expect(hoursLine({ weekHours: 18, contractedHours: 24 })).toBe('18 / 24 h this week');
    expect(hoursLine({ weekHours: 7.5, contractedHours: null })).toBe('7.5 h this week');
  });
  it('says when the next thing expires, and flags the next 30 days', () => {
    const today = '2026-10-31';
    expect(expiryLine(null, today)).toBeNull();
    expect(expiryLine({ name: 'First aid', date: '2026-10-31' }, today)).toEqual({ text: 'First aid expires today', soon: true });
    expect(expiryLine({ name: 'First aid', date: '2026-11-01' }, today)).toEqual({ text: 'First aid expires tomorrow', soon: true });
    expect(expiryLine({ name: 'Visa', date: '2026-11-20' }, today)).toEqual({ text: 'Visa expires in 20 days', soon: true });
    expect(expiryLine({ name: 'Visa', date: '2026-12-20' }, today)).toEqual({ text: 'Visa expires in 50 days', soon: false });
    expect(expiryLine({ name: 'Police check', date: '2027-03-01' }, today)?.text).toBe('Police check expires 1 Mar 2027');
  });
  it('fits the badges and counts the rest', () => {
    expect(badgeList(['A', 'B', 'C', 'D', 'E', 'F'], 4)).toEqual({ shown: ['A', 'B', 'C', 'D'], more: 2 });
    expect(badgeList(['A'], 4)).toEqual({ shown: ['A'], more: 0 });
  });
});

describe("the person's tabs", () => {
  const words = { credentials: 'Credentials', shifts: 'Shifts' };
  it('flags must-haves to fix and right to work, not expiring or should-haves', () => {
    const tabs = personTabs({
      issues: [
        { typeName: 'First aid', severity: 'hard', problem: 'missing' },
        { typeName: 'Police check', severity: 'hard', problem: 'expiring' },
        { typeName: 'Food safety', severity: 'warning', problem: 'missing' },
        { typeName: 'Right to work', severity: 'hard', problem: 'missing' },
      ], rtwIssue: 'missing', onboarding: false, words,
    });
    expect(tabs.map(t => `${t.label}${t.flag ? `(${t.flag})` : ''}`)).toEqual([
      'Overview', 'Credentials(1)', 'Right to work(!)', 'Employment', 'Availability & leave', 'Shifts', 'Details']);
  });
});
