import { describe, expect, it } from 'vitest';
import { smsPartsLine, templateName, textsThisMonth } from '../lib/messages';

describe('Messages page wording', () => {
  it('names every kind of message, with a readable fallback', () => {
    expect(templateName('agency_put_forward')).toBe('Agency put someone forward');
    expect(templateName('something_new')).toBe('something new');
  });
  it('says how many parts a text is and why it cost more', () => {
    expect(smsPartsLine(1)).toBe('1 part');
    expect(smsPartsLine(2, [])).toBe('2 parts');
    expect(smsPartsLine(3, ['ā'])).toBe('3 parts, sent as Unicode because of “ā”');
    expect(smsPartsLine(4, ['a', 'b', 'c', 'd'])).toBe('4 parts, sent as Unicode because of “a”, “b”, “c” and others');
  });
  it('adds parts to the month only when they differ from the count', () => {
    expect(textsThisMonth(3, 2000, 3)).toBe('3 of 2000');
    expect(textsThisMonth(3, 2000, 5)).toBe('3 of 2000 (5 parts)');
    expect(textsThisMonth(3, 2000, undefined)).toBe('3 of 2000');
  });
});
