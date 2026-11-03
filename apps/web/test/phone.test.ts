import { describe, expect, it } from 'vitest';
import { mobileExample, showMobile, telHref } from '../lib/phone';

describe('mobiles', () => {
  it("shows a mobile in the business's own country's form", () => {
    expect(showMobile('+61412345678', 'AU')).toBe('0412 345 678');
    expect(showMobile('+64211234567', 'NZ')).toBe('021 123 4567');
    expect(showMobile('+642212345678', 'NZ')).toBe('022 1234 5678');
    expect(showMobile('+6427123456', 'NZ')).toBe('027 123 456');
    expect(showMobile('+12125550123', 'US')).toBe('(212) 555-0123');
    expect(showMobile('+447700900123', 'GB')).toBe('07700 900123');
    expect(showMobile('+61412345678', undefined)).toBe('0412 345 678');
  });
  it('shows a number from another country with its code', () => {
    expect(showMobile('+64211234567', 'AU')).toBe('+64 21 123 4567');
    expect(showMobile('+61412345678', 'NZ')).toBe('+61 412 345 678');
    expect(showMobile('+12125550123', 'AU')).toBe('+1 212 555 0123');
    expect(showMobile('+447700900123', 'AU')).toBe('+44 7700 900123');
  });
  it('shows numbers saved before in any other form as they are', () => {
    expect(showMobile('0412 345 678', 'AU')).toBe('0412 345 678');
    expect(showMobile('03 9000 0000', 'AU')).toBe('03 9000 0000');
    expect(showMobile(null, 'AU')).toBe('');
  });
  it('gives an example per country and a tel: link', () => {
    expect(mobileExample('NZ')).toBe('021 123 4567');
    expect(mobileExample('FR')).toBe('0412 345 678');
    expect(telHref('0412 345 678')).toBe('tel:0412345678');
    expect(telHref('+61412345678')).toBe('tel:+61412345678');
  });
});
