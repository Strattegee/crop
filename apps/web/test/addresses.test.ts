import { describe, expect, it } from 'vitest';
import { addressTitle, earlierLine, noCurrentLine } from '../lib/addresses';

describe('addresses on the person page (David, 3 Nov, answer 5)', () => {
  const when = (iso: string) => iso.slice(0, 10);
  it('names an address with its label when it has one', () => {
    expect(addressTitle({ label: 'Home', line: '12 Example Street, Richmond VIC 3121' })).toBe('Home: 12 Example Street, Richmond VIC 3121');
    expect(addressTitle({ label: null, line: '1 A St' })).toBe('1 A St');
  });

  it('words what happened to an earlier version', () => {
    expect(earlierLine({ ended: 'corrected', replacedAt: '2026-11-04T01:00:00Z', removedAt: null, removedReason: null }, when)).toBe('Corrected 2026-11-04');
    expect(earlierLine({ ended: 'removed', replacedAt: null, removedAt: '2026-11-03T01:00:00Z', removedReason: 'Moved out' }, when)).toBe('Taken off the list 2026-11-03 · Moved out');
    expect(earlierLine({ ended: 'removed', replacedAt: null, removedAt: '2026-11-03T01:00:00Z', removedReason: null }, when)).toBe('Taken off the list 2026-11-03');
  });

  it('says when nobody is current', () => {
    expect(noCurrentLine(0)).toBe('No address recorded yet.');
    expect(noCurrentLine(2)).toMatch(/choose one below/);
  });
});
