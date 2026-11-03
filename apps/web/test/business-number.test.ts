import { describe, expect, it } from 'vitest';
import { businessNumberKind, showBusinessNumber } from '../lib/business-number';

describe('business number per country', () => {
  it("names it in the business's country's words", () => {
    expect(businessNumberKind('AU').label).toBe('ABN');
    expect(businessNumberKind('NZ').label).toBe('NZBN');
    expect(businessNumberKind('US').label).toBe('EIN');
    expect(businessNumberKind('GB').label).toBe('Company number');
    expect(businessNumberKind(undefined).label).toBe('ABN');
  });

  it('writes stored numbers the usual way', () => {
    expect(showBusinessNumber('51824753556')).toBe('51 824 753 556');
    expect(showBusinessNumber('123456789')).toBe('12-3456789');
    expect(showBusinessNumber('SC123456')).toBe('SC123456');
    expect(showBusinessNumber('9429041234567')).toBe('9429041234567');
    expect(showBusinessNumber(null)).toBe('—');
  });
});
