import { describe, expect, it } from 'vitest';
import { distanceKm, distanceWords, parsePostcodeTable, postcodeDistance, postcodeKeys, postcodePoint } from '../src/geo/distance.js';

describe('postcode distances (David, 4 Nov)', () => {
  it('tidies postcodes per country before looking them up', () => {
    expect(postcodeKeys('AU', ' 3000 ')).toEqual(['3000']);
    expect(postcodeKeys('NZ', '6011')).toEqual(['6011']);
    expect(postcodeKeys('US', '10001-1234')).toEqual(['10001']);
    expect(postcodeKeys('US', '1000')).toEqual([]);
    expect(postcodeKeys('GB', 'ls11ur')).toEqual(['LS1 1UR', 'LS1']);
    expect(postcodeKeys('GB', 'sw1a')).toEqual(['SW1A']);
    expect(postcodeKeys('GB', 'not a code')).toEqual([]);
  });

  it('finds points in each country, and null for unknown ones', () => {
    const mel = postcodePoint('AU', '3000')!;
    expect(mel.lat).toBeCloseTo(-37.81, 1);
    expect(mel.lon).toBeCloseTo(144.96, 1);
    expect(postcodePoint('NZ', '6011')!.lat).toBeCloseTo(-41.29, 0);
    expect(postcodePoint('US', '10001')!.lat).toBeCloseTo(40.75, 1);
    expect(postcodePoint('GB', 'LS1 1UR')!.lat).toBeCloseTo(53.8, 1); // outward code fallback
    expect(postcodePoint('AU', '0000')).toBeNull();
    expect(postcodePoint('AU', null)).toBeNull();
    expect(postcodePoint('FR', '75001')).toBeNull();
  });

  it('works out straight-line distances, never across countries', () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.2, 0);
    const melSyd = postcodeDistance({ country: 'AU', postcode: '3000' }, { country: 'AU', postcode: '2000' })!;
    expect(melSyd).toBeGreaterThan(700);
    expect(melSyd).toBeLessThan(730);
    const leedsLondon = postcodeDistance({ country: 'GB', postcode: 'LS1 4AP' }, { country: 'GB', postcode: 'SW1A 1AA' })!;
    expect(leedsLondon).toBeGreaterThan(260);
    expect(leedsLondon).toBeLessThan(300);
    const nyBoston = postcodeDistance({ country: 'US', postcode: '10001' }, { country: 'US', postcode: '02108' })!;
    expect(nyBoston).toBeGreaterThan(280);
    expect(nyBoston).toBeLessThan(320);
    const wlgAkl = postcodeDistance({ country: 'NZ', postcode: '6011' }, { country: 'NZ', postcode: '1010' })!;
    expect(wlgAkl).toBeGreaterThan(450);
    expect(wlgAkl).toBeLessThan(520);
    expect(postcodeDistance({ country: 'AU', postcode: '3000' }, { country: 'NZ', postcode: '6011' })).toBeNull();
    expect(postcodeDistance({ country: 'AU', postcode: '3000' }, { country: 'AU', postcode: null })).toBeNull();
    expect(postcodeDistance({ country: 'AU', postcode: '9999' }, { country: 'AU', postcode: '3000' })).toBeNull();
    expect(postcodeDistance({ country: 'AU', postcode: '3000' }, { country: 'AU', postcode: '3000' })).toBe(0);
  });

  it('words distances plainly', () => {
    expect(distanceWords(0)).toBe('<1 km');
    expect(distanceWords(0.6)).toBe('<1 km');
    expect(distanceWords(12.4)).toBe('12 km');
    expect(distanceWords(139.6)).toBe('140 km');
    expect(distanceWords(1250)).toBe('1,250 km');
    expect(distanceWords(null)).toBeNull();
  });

  it('reads the data files line by line', () => {
    const t = parsePostcodeTable('3000\t-37.814\t144.963\nbad\n\n3001\tx\t1\n');
    expect([...t.keys()]).toEqual(['3000']);
  });
});
