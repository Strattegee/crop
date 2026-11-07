import { describe, expect, it } from 'vitest';
import { clearFiltersHref, parseQueueParams, queueHidden, queueHref, queueQuery } from '../lib/allocation-queue';
import {
  NO_QUEUE_FILTERS, areaSummary, chosenSummary, dateChoiceLabel, filterEntries, filtersOn, nextSort, parseQueueFilters, parseQueueSort, placeSummary, sortMark, sortedLine,
  whenSummary, withChosen,
} from '../lib/queue-filters';

const C = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const S = '6f1c1f8e-0b6a-4a51-9a51-1b2c3d4e5f60';

describe('allocation queue column filters (David, 7 Nov)', () => {
  it('reads the filters from the URL, repeated or comma separated, leaving out anything odd', () => {
    expect(parseQueueFilters({})).toEqual(NO_QUEUE_FILTERS);
    const f = parseQueueFilters({
      band: ['soon', 'started', 'nope'], waiting: '4h', stages: 'new,pulled_out', rank: '1,none,9', clients: `${C.toUpperCase()},bad`, sites: S,
      area: ' east ', roles: ['Nurse', 'Carer'], dates: '2026-11-07,7 Nov', part: 'am,dusk', hrs: 'gt8', progress: 'some_declined', on: 'others',
    });
    expect(f).toEqual({ band: ['soon', 'started'], waiting: '4h', stages: ['new', 'pulled_out'], rank: ['1', 'none'], clients: [C], sites: [S], area: 'east',
      roles: ['Nurse', 'Carer'], dates: ['2026-11-07'], part: ['am'], hrs: 'gt8', progress: ['some_declined'], on: 'others' });
    expect(parseQueueFilters({ waiting: '2h', hrs: '9', on: 'me' })).toEqual(NO_QUEUE_FILTERS);
    expect(filtersOn(f)).toBe(10);
    // Client, site and area are one column; day and part of the day too.
    expect(filtersOn({ ...NO_QUEUE_FILTERS, clients: [C], area: 'x', part: ['am'] })).toBe(2);
    expect(filterEntries(f)).toContainEqual(['rank', '1,none']);
  });

  it('keeps the filters and order in the page’s links and the API query, and clears them', () => {
    const p = parseQueueParams({ stage: 'new', office: 'all', band: 'soon', roles: 'Nurse', sort: '-rank', shift: S });
    expect(queueHref(p)).toBe(`/allocations?stage=new&office=all&band=soon&roles=Nurse&sort=-rank&shift=${S}`);
    expect(queueQuery(p)).toBe('days=3&stage=new&office=all&band=soon&roles=Nurse&sort=-rank');
    expect(clearFiltersHref(p)).toBe(`/allocations?stage=new&office=all&sort=-rank&shift=${S}`);
    // A form that sends the filters itself carries everything else (paging starts again).
    expect(queueHidden({ ...p, period: 'month', limit: 500 }, ['band', 'roles'])).toEqual([
      ['stage', 'new'], ['office', 'all'], ['period', 'month'], ['sort', '-rank'], ['shift', S]]);
    expect(parseQueueSort('-sideways')).toBeNull();
    expect(parseQueueSort('when')).toBe('when');
  });

  it('turns a heading’s order round, then back to the queue order', () => {
    expect(nextSort(null, 'rank')).toBe('rank');
    expect(nextSort('rank', 'rank')).toBe('-rank');
    expect(nextSort('-rank', 'rank')).toBeNull();
    expect(nextSort('-rank', 'role')).toBe('role');
    expect([sortMark('rank', 'rank'), sortMark('-rank', 'rank'), sortMark('role', 'rank')]).toEqual([' ↑', ' ↓', '']);
    expect(sortedLine('-client', { client: 'Customer', role: 'Position' })).toBe('Sorted by customer, turned round');
    expect(sortedLine('waiting', { client: 'Client', role: 'Role' })).toBe('Sorted by waiting');
    expect(sortedLine('site', { client: 'Client', role: 'Role', site: 'Facility', area: 'Ward' })).toBe('Sorted by facility');
    expect(sortedLine('-area', { client: 'Client', role: 'Role', site: 'Facility', area: 'Ward' })).toBe('Sorted by ward, turned round');
  });

  it('words the headings’ summaries and keeps chosen values that dropped out of the rows', () => {
    expect(chosenSummary([], x => x)).toBe('Any');
    expect(chosenSummary(['a'], x => x.toUpperCase())).toBe('A');
    expect(chosenSummary(['a', 'b', 'c'], x => x)).toBe('3 chosen');
    expect(dateChoiceLabel('2026-11-07')).toBe('Sat 7 Nov');
    expect(whenSummary({ ...NO_QUEUE_FILTERS, dates: ['2026-11-07'], part: ['night'] })).toBe('Sat 7 Nov, Night');
    const o = { stages: [], clients: [{ id: C, name: 'Bayside' }], sites: [{ id: S, name: 'Campus', clientId: C }], roles: [], dates: [] };
    expect(placeSummary(NO_QUEUE_FILTERS, o)).toBe('Any');
    expect(areaSummary(NO_QUEUE_FILTERS)).toBe('Any');
    expect(areaSummary({ ...NO_QUEUE_FILTERS, area: 'east' })).toBe('“east”');
    expect(placeSummary({ ...NO_QUEUE_FILTERS, clients: [C], area: 'east' }, o)).toBe('Bayside, “east”');
    expect(placeSummary({ ...NO_QUEUE_FILTERS, clients: [C, S] }, o)).toBe('2 chosen');
    expect(withChosen([{ value: 'a', label: 'A' }], ['a', 'b'], v => `(${v})`)).toEqual([{ value: 'a', label: 'A' }, { value: 'b', label: '(b)' }]);
  });
});
