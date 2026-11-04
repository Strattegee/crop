import { describe, expect, it } from 'vitest';
import { DEFAULT_DISTANCE_FREE_KM, DISTANCE_BAND_KM, distanceBand, distanceKm, distanceWords, farAwayLast, homeWords, parsePostcodeTable, postcodeDistance, postcodeKeys, postcodePoint } from '../src/geo/distance.js';
import { offerMessage } from '../src/roster/bank-fill.js';

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

describe('distance in ranking (David, 4 Nov: only when far away)', () => {
  const c = (name: string, distanceKm: number | null, more: Partial<{ eligible: boolean; available: boolean; warnings: unknown[]; team: unknown }> = {}) =>
    ({ name, distanceKm, eligible: true, available: true, warnings: [] as unknown[], team: null as unknown, ...more });
  const names = (l: { name: string }[]) => l.map(x => x.name);

  it('counts distance only beyond the free range, in 10 km bands', () => {
    expect(DEFAULT_DISTANCE_FREE_KM).toBe(25);
    expect(DISTANCE_BAND_KM).toBe(10);
    expect(distanceBand(null, 25)).toBe(0);
    expect(distanceBand(undefined, 25)).toBe(0);
    expect(distanceBand(3, 25)).toBe(0);
    expect(distanceBand(25, 25)).toBe(0);
    expect(distanceBand(25.1, 25)).toBe(1);
    expect(distanceBand(34.9, 25)).toBe(1);
    expect(distanceBand(35, 25)).toBe(2);
    expect(distanceBand(400, 25)).toBe(38);
    expect(distanceBand(400, 0)).toBe(0); // 0 = distance never counts
  });

  it('puts far-away people after the others in their group, nearer bands first, otherwise keeping the order', () => {
    const list = [c('Far', 80), c('Near', 5), c('Unknown', null), c('Bit far', 30), c('Also bit far', 33), c('Edge', 25)];
    expect(names(farAwayLast(list, 25))).toEqual(['Near', 'Unknown', 'Edge', 'Bit far', 'Also bit far', 'Far']);
    expect(names(farAwayLast(list, 0))).toEqual(names(list)); // switched off
    expect(names(farAwayLast(list, 100))).toEqual(names(list)); // everyone within range
  });

  it('never moves anyone out of their eligibility group or ahead of the team', () => {
    const list = [
      c('Team far', 90, { team: { teamRole: 'member' } }), c('Ready far', 90), c('Ready near', 2),
      c('Warned near', 1, { warnings: ['x'] }), c('Unavailable near', 1, { available: false }), c('Blocked near', 1, { eligible: false }),
    ];
    expect(names(farAwayLast(list, 25))).toEqual(['Team far', 'Ready near', 'Ready far', 'Warned near', 'Unavailable near', 'Blocked near']);
  });

  it('words the distance for the person themselves', () => {
    expect(homeWords(12.4)).toBe('about 12 km from home');
    expect(homeWords(0.3)).toBe('under 1 km from home');
    expect(homeWords(1250)).toBe('about 1,250 km from home');
    expect(homeWords(null)).toBeNull();
  });

  it('adds it to the offer message only when known, in plain characters for texts', () => {
    const s = { role: 'Chef', localDate: '2026-11-02', localStart: '07:00', localEnd: '15:30', facilityName: 'Harbour Kitchen', areaName: null };
    const m = offerMessage('Ana', 'Demo Cafe', { ...s, distanceKm: 12.4 }, null, 'https://crop.test/offer/abc');
    expect(m.sms).toBe('Hi Ana, Demo Cafe has a shift for you: Mon 2 Nov, 07:00–15:30, Chef at Harbour Kitchen (about 12 km from home). Accept or decline: https://crop.test/offer/abc (first to accept gets it).');
    expect(m.email).toContain('Chef at Harbour Kitchen (about 12 km from home)');
    expect(m.push.body).toContain('(about 12 km from home)');
    expect(offerMessage('Ana', 'Demo Cafe', { ...s, distanceKm: null }, null).sms).not.toMatch(/km/);
    expect(offerMessage('Ana', 'Demo Cafe', s, null).sms).not.toMatch(/km/);
  });
});
