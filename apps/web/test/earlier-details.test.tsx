import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EarlierDetailsCard } from '../app/(office)/workers/[id]/earlier-details-card';
import { changedIn, earlierRows, earlierValue, earlierWhen, type EarlierDetails } from '../lib/earlier-details';

const none: EarlierDetails = { name: [], preferred_name: [], email: [], mobile: [], gender: [], date_of_birth: [] };
const h: EarlierDetails = {
  ...none,
  name: [{ value: 'Sam Example', changedAt: '2026-11-03T02:00:00.000Z', by: 'Ola Office', via: 'office' }],
  mobile: [{ value: '+61412345678', changedAt: '2026-11-02T02:00:00.000Z', by: 'Sam Sample', via: 'app' }],
  gender: [{ value: null, changedAt: '2026-11-01T02:00:00.000Z', by: null, via: 'system' }],
};

describe('earlier details (answer 5: nothing overwritten)', () => {
  it('words each value the business’s way', () => {
    expect(earlierValue('mobile', '+61412345678', 'AU')).toBe('0412 345 678');
    expect(earlierValue('gender', 'F')).toBe('Female');
    expect(earlierValue('date_of_birth', '2001-02-03')).toBe('3 Feb 2001');
    expect(earlierValue('email', null)).toBe('Not recorded');
    expect(earlierWhen(h.mobile[0], iso => iso.slice(0, 10))).toBe('Until 2026-11-02 · changed by Sam Sample (in the app)');
    expect(changedIn('Australia/Melbourne')('2026-11-03T02:00:00.000Z')).toMatch(/3 Nov 2026/);
  });

  it('lists fields in order and can leave out the date of birth', () => {
    expect(earlierRows(h).map(r => r.label)).toEqual(['Name', 'Mobile', 'Gender']);
    expect(earlierRows({ ...none, date_of_birth: h.name }, false)).toEqual([]);
    expect(earlierRows(null)).toEqual([]);
  });

  it('folds the list under the Details form, or says there is nothing yet', () => {
    const html = renderToStaticMarkup(<EarlierDetailsCard h={h} country="AU" when={iso => iso.slice(0, 10)} />);
    expect(html).toContain('Earlier values (3)');
    expect(html).toContain('Sam Example');
    expect(html).toContain('0412 345 678');
    expect(html).toContain('changed by CROP');
    expect(renderToStaticMarkup(<EarlierDetailsCard h={none} country="AU" when={String} />)).toContain('No earlier values');
    expect(renderToStaticMarkup(<EarlierDetailsCard h={null} country="AU" when={String} />)).toBe('');
  });
});
