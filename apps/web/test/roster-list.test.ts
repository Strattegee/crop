import { describe, expect, it } from 'vitest';
import {
  LIST_MAX, LIST_PAGE, bulkMessage, filterShifts, groupLine, groupShifts, listQuery, matchesSearch, pageGroups, parseListParams, parsePicks,
  pickValue, stageClass, stageTally, type ListShift,
} from '../lib/roster-list';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let n = 0;
const shift = (over: Partial<ListShift> = {}): ListShift => ({
  id: ID(++n), facilityId: ID(900), facilityName: 'North Site', areaName: 'Kitchen', role: 'Cook', status: 'open',
  localDate: '2026-11-04', localStart: '07:00', localEnd: '15:00', hours: 7.5, workerId: null, workerName: null, ...over,
});
const words = { dateLabel: (d: string) => `Day ${d}`, noArea: 'No area', unfilled: 'Unfilled', allSites: false };

describe('roster list: the URL', () => {
  it('reads the layout and list state, falling back to cards, grouped by date, first page', () => {
    expect(parseListParams({})).toEqual({ layout: 'cards', group: 'date', q: '', stage: '', area: '', person: '', limit: LIST_PAGE });
    const p = parseListParams({ layout: 'list', group: 'area', q: '  sam  ', stage: 'open', area: 'Kitchen', person: ID(1), limit: '800' });
    expect(p).toEqual({ layout: 'list', group: 'area', q: 'sam', stage: 'open', area: 'Kitchen', person: ID(1), limit: 800 });
  });
  it('ignores what it does not know', () => {
    const p = parseListParams({ layout: 'grid', group: 'colour', stage: 'done', person: 'drop table', limit: '-3' });
    expect(p).toMatchObject({ layout: 'cards', group: 'date', stage: '', person: '', limit: LIST_PAGE });
    expect(parseListParams({ limit: '999999' }).limit).toBe(LIST_MAX);
    expect(parseListParams({ person: 'none' }).person).toBe('none');
  });
  it('writes only what differs from the defaults, and nothing for cards', () => {
    expect(listQuery(parseListParams({ layout: 'list' }))).toEqual({ layout: 'list', group: undefined, q: undefined, stage: undefined, area: undefined, person: undefined, limit: undefined });
    expect(listQuery(parseListParams({ layout: 'list', group: 'role', stage: 'booked', limit: '1300' }))).toMatchObject({ group: 'role', stage: 'booked', limit: '1300' });
    expect(Object.values(listQuery(parseListParams({ group: 'role', q: 'x' }))).every(v => v === undefined)).toBe(true);
  });
});

describe('roster list: stages', () => {
  it('matches the card colours', () => {
    expect(stageClass(shift())).toBe('unfilled');
    expect(stageClass(shift({ offersPending: 2 }))).toBe('offered');
    expect(stageClass(shift({ offersPending: 2, pulledOutName: 'Sam' }))).toBe('pulled');
    expect(stageClass(shift({ status: 'assigned', workerId: ID(1) }))).toBe('allocated');
    expect(stageClass(shift({ status: 'assigned', workerId: ID(1), agencyName: 'Acme' }))).toBe('accepted');
    expect(stageClass(shift({ status: 'booked' }))).toBe('booked');
    expect(stageClass(shift({ status: 'cancelled' }))).toBe('cancelled');
    expect(stageClass(shift({ equipmentOnly: true }))).toBe('unfilled');
    expect(stageClass(shift({ equipmentOnly: true, status: 'booked' }))).toBe('booked');
  });
  it('counts each stage, with "unfilled only" = nobody on it, and leaves cancelled out of All', () => {
    const t = stageTally([shift(), shift({ offersPending: 1 }), shift({ pulledOutName: 'Jo' }), shift({ status: 'booked' }), shift({ status: 'cancelled' })]);
    expect(t).toMatchObject({ '': 4, open: 3, unfilled: 1, offered: 1, pulled: 1, booked: 1, cancelled: 1 });
  });
});

describe('roster list: filters', () => {
  const sam = shift({ status: 'booked', workerId: ID(50), workerName: 'Sam Example', role: 'Barista', areaName: 'Front' });
  const open = shift({ role: 'Cook', areaName: 'Kitchen' });
  const noArea = shift({ areaName: null, role: 'Cleaner' });
  const gone = shift({ status: 'cancelled' });
  const all = [sam, open, noArea, gone];
  const p = (over = {}) => ({ q: '', stage: '' as const, area: '', person: '', ...over });

  it('leaves cancelled out unless asked for', () => {
    expect(filterShifts(all, p(), '')).toEqual([sam, open, noArea]);
    expect(filterShifts(all, p({ stage: 'cancelled' }), '')).toEqual([gone]);
    expect(filterShifts(all, p({ stage: 'open' }), '')).toEqual([open, noArea]);
  });
  it('filters by role (the strip filter), area (- = none) and person (none = nobody on it)', () => {
    expect(filterShifts(all, p(), 'Barista')).toEqual([sam]);
    expect(filterShifts(all, p({ area: '-' }), '')).toEqual([noArea]);
    expect(filterShifts(all, p({ person: ID(50) }), '')).toEqual([sam]);
    expect(filterShifts(all, p({ person: 'none' }), '')).toEqual([open, noArea]);
  });
  it('searches every word across person, role, area and site', () => {
    expect(matchesSearch(sam, 'sam front')).toBe(true);
    expect(matchesSearch(sam, 'SAM kitchen')).toBe(false);
    expect(matchesSearch(open, 'north cook')).toBe(true);
    expect(filterShifts(all, p({ q: 'example' }), '')).toEqual([sam]);
  });
  it('can count before the stage filter, for the chips', () => {
    expect(filterShifts(all, p({ stage: 'booked' }), '', 'stage')).toHaveLength(4);
  });
});

describe('roster list: groups', () => {
  const a = shift({ localDate: '2026-11-05', localStart: '09:00', areaName: 'Kitchen' });
  const b = shift({ localDate: '2026-11-04', localStart: '09:00', areaName: 'Kitchen', status: 'booked', workerId: ID(7), workerName: 'Zoe' });
  const c = shift({ localDate: '2026-11-04', localStart: '07:00', areaName: null, hours: 4 });
  const d = shift({ localDate: '2026-11-04', localStart: '07:00', areaName: 'Bar', status: 'cancelled', hours: 8 });

  it('groups by date in date order, rows by start then area', () => {
    const g = groupShifts([a, b, c, d], 'date', words);
    expect(g.map(x => x.title)).toEqual(['Day 2026-11-04', 'Day 2026-11-05']);
    expect(g[0]!.shifts).toEqual([d, c, b]);
  });
  it('counts unfilled and hours without cancelled ones', () => {
    const g = groupShifts([b, c, d], 'date', words)[0]!;
    expect(g.unfilled).toBe(1);
    expect(g.hours).toBe(11.5);
    expect(groupLine(g, k => `${k} shifts`)).toBe('3 shifts · 1 unfilled · 11.5 h');
    expect(groupLine({ ...g, unfilled: 0 }, k => `${k} shifts`)).toBe('3 shifts · 11.5 h');
  });
  it('groups by area, no area last, and names the site when several are shown', () => {
    expect(groupShifts([a, b, c, d], 'area', words).map(x => x.title)).toEqual(['Bar', 'Kitchen', 'No area']);
    const other = shift({ facilityId: ID(901), facilityName: 'Alpha Site', areaName: 'Kitchen' });
    expect(groupShifts([a, other], 'area', { ...words, allSites: true }).map(x => x.title)).toEqual(['Kitchen · Alpha Site', 'Kitchen · North Site']);
  });
  it('groups by person with Unfilled first, and by stage in Steve’s order', () => {
    expect(groupShifts([a, b], 'person', words).map(x => x.title)).toEqual(['Unfilled', 'Zoe']);
    expect(groupShifts([b, a, d], 'stage', words).map(x => x.title)).toEqual(['Unfilled', 'Booked', 'Cancelled']);
  });
  it('draws the first rows across groups and says how many are left', () => {
    const g = groupShifts([a, b, c, d], 'date', words);
    const pg = pageGroups(g, 2);
    expect(pg.hidden).toBe(2);
    expect(pg.groups.map(x => [x.shown.length, x.notShown])).toEqual([[2, 1], [0, 1]]);
  });
});

describe('roster list: bulk actions', () => {
  it('reads ticked rows in date order without repeats or junk', () => {
    const x = shift({ localDate: '2026-11-06', localStart: '06:00' });
    const y = shift({ localDate: '2026-11-04', localStart: '18:00' });
    expect(parsePicks([pickValue(x), pickValue(y), pickValue(x), 'nonsense|2026-11-01|07:00'])).toEqual([
      { id: y.id, date: '2026-11-04', start: '18:00' }, { id: x.id, date: '2026-11-06', start: '06:00' },
    ]);
  });
  it('says what was done and why the rest were not', () => {
    const count = (k: number) => `${k} ${k === 1 ? 'shift' : 'shifts'}`;
    expect(bulkMessage('Confirmed', [{ label: 'Wed 4 Nov', ok: true }, { label: 'Thu 5 Nov', ok: true }], count)).toEqual({ done: 'Confirmed 2 shifts.' });
    expect(bulkMessage('Confirmed', [{ label: 'Wed 4 Nov', ok: true }, { label: 'Thu 5 Nov', ok: false, message: 'The week is locked.' }], count, 'Not confirmed'))
      .toEqual({ done: 'Confirmed 1 shift. Not confirmed (1): Thu 5 Nov (The week is locked).' });
    expect(bulkMessage('Cancelled', [{ label: 'Wed 4 Nov', ok: false, message: 'gone' }], count).error).toBe('Nothing changed. Not done (1): Wed 4 Nov (gone).');
    const many = Array.from({ length: 10 }, (_, i) => ({ label: `S${i}`, ok: false, message: 'no' }));
    expect(bulkMessage('Confirmed', many, count).error).toContain('; and 2 more.');
  });
});
