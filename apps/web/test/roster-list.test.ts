import { describe, expect, it } from 'vitest';
import {
  FILTER_KEYS, LIST_KEYS, LIST_MAX, LIST_PAGE, bandOf, bulkMessage, chipOn, filterCount, filterShifts, groupLine, groupShifts, joinKnown, lengthOf, listQuery,
  matchesSearch, offAll, pageGroups, parseListParams, parsePicks, periodOf, pickValue, sortMark, sortOver, splitList, stageClass, stageParam, stageTally, tlineOf,
  type ListParams, type ListShift, type RowFacts,
} from '../lib/roster-list';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let n = 0;
const shift = (over: Partial<ListShift> = {}): ListShift => ({
  id: ID(++n), facilityId: ID(900), facilityName: 'North Site', areaName: 'Kitchen', role: 'Cook', status: 'open',
  localDate: '2026-11-04', localStart: '07:00', localEnd: '15:00', hours: 7.5, workerId: null, workerName: null, ...over,
});
const words = { dateLabel: (d: string) => `Day ${d}`, noArea: 'No area', unfilled: 'Unfilled', allSites: false };

const DEFAULTS = {
  layout: 'cards', group: 'date', q: '', stages: [], areas: [], person: '', who: '', days: [], bands: [], periods: [], sites: [], lengths: [],
  marks: [], tlines: [], warns: [], pstages: [], sort: 'time', desc: false, limit: LIST_PAGE,
};

describe('roster list: the URL', () => {
  it('reads the layout and list state, falling back to cards, grouped by date, first page', () => {
    expect(parseListParams({})).toEqual(DEFAULTS);
    const p = parseListParams({ layout: 'list', group: 'area', q: '  sam  ', stage: 'open', area: 'Kitchen', person: ID(1), limit: '800' });
    expect(p).toMatchObject({ layout: 'list', group: 'area', q: 'sam', stages: ['unfilled', 'offered', 'pulled'], areas: ['Kitchen'], person: ID(1), limit: 800 });
  });
  it('reads comma lists and repeated parameters (a form\'s tick boxes) for every column', () => {
    const p = parseListParams({
      layout: 'list', stage: ['booked', 'cancelled'], area: 'Kitchen,Bar', day: '2026-11-05,2026-11-03,nope', band: ['early', 'noon'], ap: 'night',
      fac: `${ID(900)},x`, len: 'short,long', mk: 'vehicle,ringed,glitter', tl: 'away', warn: 'blocked,none', pst: `none,${ID(3)}`, who: ' jo ', sort: '-hours',
    });
    expect(p).toMatchObject({
      stages: ['booked', 'cancelled'], areas: ['Kitchen', 'Bar'], days: ['2026-11-03', '2026-11-05'], bands: ['early'], periods: ['night'], sites: [ID(900)],
      lengths: ['short', 'long'], marks: ['vehicle', 'ringed'], tlines: ['away'], warns: ['blocked', 'none'], pstages: ['none', ID(3)], who: 'jo', sort: 'hours', desc: true,
    });
  });
  it('ignores what it does not know', () => {
    const p = parseListParams({ layout: 'grid', group: 'colour', stage: 'done', person: 'drop table', limit: '-3', sort: 'colour' });
    expect(p).toMatchObject({ layout: 'cards', group: 'date', stages: [], person: '', limit: LIST_PAGE, sort: 'time' });
    expect(parseListParams({ limit: '999999' }).limit).toBe(LIST_MAX);
    expect(parseListParams({ person: 'none' }).person).toBe('none');
    expect(parseListParams({ person: 'agency' }).person).toBe('agency');
  });
  it('writes only what differs from the defaults, and nothing for cards', () => {
    const q = listQuery(parseListParams({ layout: 'list' }));
    expect(q.layout).toBe('list');
    expect(Object.entries(q).filter(([k, v]) => k !== 'layout' && v !== undefined)).toEqual([]);
    expect(listQuery(parseListParams({ layout: 'list', group: 'role', stage: 'booked', limit: '1300' }))).toMatchObject({ group: 'role', stage: 'booked', limit: '1300' });
    expect(Object.values(listQuery(parseListParams({ group: 'role', q: 'x', mk: 'vehicle' }))).every(v => v === undefined)).toBe(true);
  });
  it('writes the Unfilled-only set as "open" and lists with commas, so it reads back the same', () => {
    expect(stageParam(['unfilled', 'offered', 'pulled'])).toBe('open');
    expect(stageParam(['booked', 'unfilled'])).toBe('booked,unfilled');
    expect(stageParam([])).toBeUndefined();
    const p = parseListParams({ layout: 'list', stage: 'pulled,offered,unfilled', mk: ['duty', 'items'], sort: 'site' });
    const q = listQuery(p);
    expect(q).toMatchObject({ stage: 'open', mk: 'duty,items', sort: 'site' });
    expect(parseListParams(q)).toEqual(p);
  });
  it('the stage chips are presets of the Stage column', () => {
    expect(chipOn(parseListParams({}), '')).toBe(true);
    expect(chipOn(parseListParams({ stage: 'offered,unfilled,pulled' }), 'open')).toBe(true);
    expect(chipOn(parseListParams({ stage: 'booked' }), 'booked')).toBe(true);
    expect(chipOn(parseListParams({ stage: 'booked,cancelled' }), 'booked')).toBe(false);
  });
  it('sorts by a heading, turning it round on a second click; hours start longest first', () => {
    expect(sortOver(parseListParams({}), 'site')).toEqual({ sort: 'site', limit: undefined });
    expect(sortOver(parseListParams({ sort: 'site' }), 'site')).toEqual({ sort: '-site', limit: undefined });
    expect(sortOver(parseListParams({}), 'hours').sort).toBe('-hours');
    expect(sortOver(parseListParams({}), 'time').sort).toBe('-time');
    expect(sortOver(parseListParams({ sort: '-time' }), 'time').sort).toBeUndefined();
    expect(sortMark(parseListParams({ sort: '-hours' }), 'hours')).toBe(' ↓');
  });
  it('counts the filters that are on, and Clear turns them all off', () => {
    expect(filterCount(parseListParams({ q: 'a', who: 'b', mk: 'duty', band: 'early', ap: 'am' }), ['Cook'])).toBe(4);
    expect(offAll(FILTER_KEYS)).toMatchObject({ role: undefined, mk: undefined, stage: undefined });
    expect(LIST_KEYS).toContain('sort');
  });
  it('joins names that hold a comma when the pieces make a known name', () => {
    expect(joinKnown(splitList('Ward 3, East,Kitchen'), ['Ward 3, East', 'Kitchen'])).toEqual(['Ward 3, East', 'Kitchen']);
    expect(joinKnown(splitList('A,B'), ['A', 'B'])).toEqual(['A', 'B']);
    expect(joinKnown(['Cook'], [])).toEqual(['Cook']);
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
  const sam = shift({ status: 'booked', workerId: ID(50), workerName: 'Sam Example', role: 'Barista', areaName: 'Front', localStart: '05:30', hours: 3.5, usualWorkerId: ID(51), usualAway: 'on_leave' });
  const open = shift({ role: 'Cook', areaName: 'Kitchen', localStart: '13:00', hours: 8, usualWorkerId: ID(52) });
  const noArea = shift({ areaName: null, role: 'Cleaner', localDate: '2026-11-05', localStart: '22:00', hours: 9, facilityId: ID(901), projectStageId: ID(7) });
  const gone = shift({ status: 'cancelled' });
  const agency = shift({ status: 'assigned', workerId: ID(60), workerName: 'Lee Temp', agencyName: 'Acme Staff', usualWorkerId: ID(60), role: 'Porter' });
  const all = [sam, open, noArea, gone, agency];
  const p = (over: Partial<ListParams> = {}) => ({ ...parseListParams({}), ...over });

  it('leaves cancelled out unless asked for, and takes several stages', () => {
    expect(filterShifts(all, p())).toEqual([sam, open, noArea, agency]);
    expect(filterShifts(all, p({ stages: ['cancelled'] }))).toEqual([gone]);
    expect(filterShifts(all, p({ stages: ['unfilled', 'offered', 'pulled'] }))).toEqual([open, noArea]);
    expect(filterShifts(all, p({ stages: ['booked', 'accepted'] }))).toEqual([sam, agency]);
  });
  it('filters by roles (the strip filter), areas (- = none) and person (none = unfilled, agency = agency people)', () => {
    expect(filterShifts(all, p(), { roles: ['Barista'] })).toEqual([sam]);
    expect(filterShifts(all, p(), { roles: ['Barista', 'Cook'] })).toEqual([sam, open]);
    expect(filterShifts(all, p({ areas: ['-'] }))).toEqual([noArea]);
    expect(filterShifts(all, p({ areas: ['-', 'Front'] }))).toEqual([sam, noArea]);
    expect(filterShifts(all, p({ person: ID(50) }))).toEqual([sam]);
    expect(filterShifts(all, p({ person: 'none' }))).toEqual([open, noArea]);
    expect(filterShifts(all, p({ person: 'agency' }))).toEqual([agency]);
  });
  it('searches every word across person, role, area and site; the Staff search reads names only', () => {
    expect(matchesSearch(sam, 'sam front')).toBe(true);
    expect(matchesSearch(sam, 'SAM kitchen')).toBe(false);
    expect(matchesSearch(open, 'north cook')).toBe(true);
    expect(filterShifts(all, p({ q: 'example' }))).toEqual([sam]);
    expect(filterShifts(all, p({ who: 'acme' }))).toEqual([agency]);
    expect(filterShifts(all, p({ who: 'cook' }))).toEqual([]);
  });
  it('filters the time by start band, card letter and (week view) day', () => {
    expect(bandOf('05:59')).toBe('early');
    expect(bandOf('06:00')).toBe('morning');
    expect(bandOf('12:00')).toBe('afternoon');
    expect(bandOf('17:00')).toBe('evening');
    expect(bandOf('21:00')).toBe('night');
    expect(periodOf('05:00')).toBe('am');
    expect(periodOf('18:59')).toBe('pm');
    expect(periodOf('04:59')).toBe('night');
    expect(filterShifts(all, p({ bands: ['early', 'night'] }))).toEqual([sam, noArea]);
    expect(filterShifts(all, p({ periods: ['pm'] }))).toEqual([open]);
    const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    expect(filterShifts(all, p({ days: ['2026-11-05'] }), { weekDays: week })).toEqual([noArea]);
    // Another week's day, or day view: no day filter.
    expect(filterShifts(all, p({ days: ['2026-12-01'] }), { weekDays: week })).toHaveLength(4);
    expect(filterShifts(all, p({ days: ['2026-11-05'] }), { weekDays: null })).toHaveLength(4);
  });
  it('filters sites only with every site on screen, and hours by length', () => {
    expect(filterShifts(all, p({ sites: [ID(901)] }))).toEqual([noArea]);
    expect(filterShifts(all, p({ sites: [ID(901)] }), { allSites: false })).toHaveLength(4);
    expect(lengthOf(3.9)).toBe('short');
    expect(lengthOf(4)).toBe('mid');
    expect(lengthOf(8)).toBe('mid');
    expect(lengthOf(8.5)).toBe('long');
    expect(filterShifts(all, p({ lengths: ['short', 'long'] }))).toEqual([sam, noArea]);
  });
  it('filters the T line (usual away, someone else on it, no usual person) and the project stage', () => {
    expect(tlineOf(sam)).toEqual(['away', 'differs']);
    expect(tlineOf(agency)).toEqual([]);
    expect(filterShifts(all, p({ tlines: ['away'] }))).toEqual([sam]);
    expect(filterShifts(all, p({ tlines: ['differs'] }))).toEqual([sam]);
    expect(filterShifts(all, p({ tlines: ['none'] }))).toEqual([noArea]);
    expect(filterShifts(all, p({ pstages: [ID(7)] }))).toEqual([noArea]);
    expect(filterShifts(all, p({ pstages: ['none'] }))).toEqual([sam, open, agency]);
  });
  it('filters letters and warnings from the row facts', () => {
    const facts = new Map<string, RowFacts>([
      [sam.id, { marks: ['vehicle', 'template'], ringed: true, blocked: false, gap: false }],
      [open.id, { marks: ['duty'], ringed: false, blocked: true, gap: false }],
      [noArea.id, { marks: [], ringed: false, blocked: false, gap: true }],
    ]);
    const o = { facts: (s: ListShift) => facts.get(s.id) ?? { marks: [], ringed: false, blocked: false, gap: false } };
    expect(filterShifts(all, p({ marks: ['vehicle'] }), o)).toEqual([sam]);
    expect(filterShifts(all, p({ marks: ['duty', 'ringed'] }), o)).toEqual([sam, open]);
    expect(filterShifts(all, p({ warns: ['blocked'] }), o)).toEqual([open]);
    expect(filterShifts(all, p({ warns: ['gap', 'ringed'] }), o)).toEqual([sam, noArea]);
    expect(filterShifts(all, p({ warns: ['none'] }), o)).toEqual([agency]);
    // Different columns must all match.
    expect(filterShifts(all, p({ marks: ['vehicle'], warns: ['blocked'] }), o)).toEqual([]);
  });
  it('can count before the stage filter, for the chips', () => {
    expect(filterShifts(all, p({ stages: ['booked'] }), { except: 'stage' })).toHaveLength(5);
  });
});

describe('roster list: sorting within groups', () => {
  const a = shift({ facilityName: 'Bravo', hours: 4, workerName: 'Zed', workerId: ID(70), localStart: '06:00' });
  const b = shift({ facilityName: 'Alpha', hours: 10, localStart: '07:00' });
  const c = shift({ facilityName: 'Alpha', hours: 6, workerName: 'Amy', workerId: ID(71), localStart: '05:00', status: 'booked' });
  it('keeps start order by default and sorts by a column on request, empty values last', () => {
    expect(groupShifts([a, b, c], 'date', words)[0]!.shifts).toEqual([c, a, b]);
    expect(groupShifts([a, b, c], 'date', words, { key: 'site', desc: false })[0]!.shifts).toEqual([c, b, a]);
    expect(groupShifts([a, b, c], 'date', words, { key: 'hours', desc: true })[0]!.shifts).toEqual([b, c, a]);
    expect(groupShifts([a, b, c], 'date', words, { key: 'person', desc: false })[0]!.shifts).toEqual([c, a, b]);
    expect(groupShifts([a, b, c], 'date', words, { key: 'person', desc: true })[0]!.shifts).toEqual([a, c, b]);
    expect(groupShifts([a, b, c], 'date', words, { key: 'stage', desc: false })[0]!.shifts).toEqual([a, b, c]);
    expect(groupShifts([a, b, c], 'date', words, { key: 'time', desc: true })[0]!.shifts).toEqual([b, a, c]);
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
