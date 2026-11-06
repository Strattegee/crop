import { describe, expect, it } from 'vitest';
import {
  BULK_MAX, LIVE_TABS, OUTCOME_TABS, bandTitle, cancelPillLabel, dayGroups, dayHeading, defaultTab, periodChoices, queueQuery, showMore, tabsFor, bestPeople, bulkReleaseMessage, releasableRows, releasePick, hereLine, nearHereLine, nearestFirst, initials, officeChipList, parseQueueParams, inTeam, teamChoicesOn, teamOn, personLine, queueHref, shortSpan, stagePill, startsIn, tabLabel, updatedWords, waitingFor,
} from '../lib/allocation-queue';

const NOW = Date.parse('2026-11-02T08:00:00Z');
const MIN = 60_000;

describe('allocation queue (David chose layout A, 2 Nov)', () => {
  it('labels tabs and stages in the business’s words', () => {
    expect(LIVE_TABS.map(t => tabLabel(t))).toEqual(['All needing someone', 'New', 'Released to bank', 'Accepted · confirm', 'Worker to confirm',
      'Client to confirm', 'Pulled out', 'Booked today']);
    const w = { client: 'Customer', worker: 'Team member', bank: 'casual pool', shifts: 'jobs' };
    expect(tabLabel('released', w)).toBe('Released to casual pool');
    expect(tabLabel('client_to_confirm', w)).toBe('Customer to confirm');
    expect(stagePill('worker_to_confirm', w)).toEqual({ label: 'Team member to confirm', cls: 'qst-worker_to_confirm' });
    expect(stagePill('pulled_out').cls).toBe('qst-pulled_out');
    expect(bandTitle('soon')).toBe('Starting within 2 hours');
  });

  it('counts down to the start, red under 2 hours and amber under 6', () => {
    const local = { dayLabel: 'Tue', localStart: '13:30' };
    const at = (mins: number) => new Date(NOW + mins * MIN).toISOString();
    expect(startsIn(at(55), NOW, local)).toEqual({ text: '55 min', tone: 'red' });
    expect(startsIn(at(100), NOW, local)).toEqual({ text: '1 h 40', tone: 'red' });
    expect(startsIn(at(300), NOW, local)).toEqual({ text: '5 h', tone: 'amber' });
    expect(startsIn(at(700), NOW, local)).toEqual({ text: '11 h', tone: '' });
    expect(startsIn(at(25 * 60), NOW, local)).toEqual({ text: 'Tue 13:30', tone: '' });
    expect(startsIn(at(-20), NOW, local)).toEqual({ text: '20 min ago', tone: 'red' });
    expect(startsIn(at(0), NOW, local).text).toBe('Started now');
  });

  it('says how long a shift has waited and when the list was updated', () => {
    expect(shortSpan(41 * MIN)).toBe('41 min');
    expect(shortSpan(370 * MIN)).toBe('6 h 10');
    expect(shortSpan(12 * 60 * MIN)).toBe('12 h');
    expect(shortSpan(50 * 60 * MIN)).toBe('2 d 2 h');
    expect(waitingFor(new Date(NOW - 41 * MIN).toISOString(), NOW)).toBe('41 min');
    expect(waitingFor(null, NOW)).toBe('–');
    expect(updatedWords(NOW - 3000, NOW)).toBe('Updated just now');
    expect(updatedWords(NOW - 40_000, NOW)).toBe('Updated 40 s ago');
    expect(updatedWords(NOW - 130_000, NOW)).toBe('Updated 2 min ago');
  });

  it('keeps the screen’s state in the URL, short', () => {
    const id = '6f1c1f8e-0b6a-4a51-9a51-1b2c3d4e5f60';
    const p = parseQueueParams({ stage: 'released', region: 'VIC', days: '7', shift: id, clientId: 'nope', view: 'odd' });
    expect(p).toEqual({ stage: 'released', office: null, region: 'VIC', clientId: null, days: 7, shift: id, view: 'queue', period: null, limit: null, near: false, crew: null });
    expect(parseQueueParams({})).toEqual({ stage: 'all', office: null, region: null, clientId: null, days: 3, shift: null, view: 'queue', period: null, limit: null, near: false, crew: null });
    expect(parseQueueParams({ office: 'ALL' }).office).toBe('all');
    expect(parseQueueParams({ office: id }).office).toBe(id);
    expect(parseQueueParams({ office: 'Melbourne' }).office).toBeNull();
    expect(queueHref(parseQueueParams({ office: 'none', stage: 'new' }))).toBe('/allocations?stage=new&office=none');
    expect(parseQueueParams({ stage: 'bogus', days: '5' })).toMatchObject({ stage: 'all', days: 3 });
    expect(queueHref(p)).toBe(`/allocations?stage=released&region=VIC&days=7&shift=${id}`);
    expect(queueHref(p, { shift: null, stage: 'all' })).toBe('/allocations?region=VIC&days=7');
    expect(queueHref(parseQueueParams({}))).toBe('/allocations');
    expect(queueHref(parseQueueParams({}), { view: 'new' })).toBe('/allocations?view=new');
  });

  it('offers calendar periods after the forward-looking ones, in the URL (David, 4 Nov)', () => {
    expect(periodChoices().map(c => c.label)).toEqual(['Next 24 hours', 'Next 3 days', 'Next 7 days', 'Next 14 days', 'Current week', 'Current month', 'Previous month']);
    expect(periodChoices().map(c => c.value)).toEqual(['1', '3', '7', '14', 'week', 'month', 'prev_month']);
    // The select sends `period`: a number of days, or a calendar period; `days=` still works.
    expect(parseQueueParams({ period: '7' })).toMatchObject({ days: 7, period: null });
    expect(parseQueueParams({ days: '14' })).toMatchObject({ days: 14, period: null });
    expect(parseQueueParams({ period: 'month' })).toMatchObject({ period: 'month', stage: 'all', days: 3 });
    expect(parseQueueParams({ period: 'prev_month' })).toMatchObject({ period: 'prev_month', stage: 'done' });
    expect(parseQueueParams({ period: 'year' })).toMatchObject({ period: null, days: 3 });
    // Outcome tabs only with a calendar period.
    expect(parseQueueParams({ stage: 'worked' }).stage).toBe('all');
    expect(parseQueueParams({ stage: 'worked', period: 'week' }).stage).toBe('worked');
    expect(defaultTab('prev_month')).toBe('done');
    expect(tabsFor(null)).toEqual(LIVE_TABS);
    expect(tabsFor('week')).toEqual([...LIVE_TABS, ...OUTCOME_TABS]);
    // Short URLs: the period's own default tab left out; limit only with a calendar period.
    expect(queueHref(parseQueueParams({ period: 'prev_month' }))).toBe('/allocations?period=prev_month');
    expect(queueHref(parseQueueParams({ period: 'prev_month', stage: 'all' }))).toBe('/allocations?stage=all&period=prev_month');
    expect(queueHref(parseQueueParams({ period: 'month', stage: 'cancelled', limit: '500' }))).toBe('/allocations?stage=cancelled&period=month&limit=500');
    expect(parseQueueParams({ period: 'month', limit: '100' }).limit).toBeNull();
    expect(parseQueueParams({ days: '7', limit: '500' }).limit).toBeNull();
    expect(queueHref(parseQueueParams({ period: '7' }))).toBe('/allocations?days=7');
    expect(queueQuery(parseQueueParams({}))).toBe('days=3');
    expect(queueQuery(parseQueueParams({ period: 'prev_month', region: 'VIC' }))).toBe('period=prev_month&region=VIC');
    expect(queueQuery(parseQueueParams({ period: 'week', stage: 'worked', limit: '750' }))).toBe('period=week&stage=worked&limit=750');
  });

  it('pages a long period, and words what happened to past shifts by day', () => {
    const p = parseQueueParams({ period: 'prev_month' });
    expect(showMore(p, 250, 7145)).toEqual({ href: '/allocations?period=prev_month&limit=500', label: 'Show 250 more (7145 not shown yet)' });
    expect(showMore(p, 500, 40)?.label).toBe('Show 40 more (40 not shown yet)');
    expect(showMore(p, 250, 0)).toBeNull();
    expect(showMore(parseQueueParams({}), 250, 10)).toBeNull();
    expect(OUTCOME_TABS.map(t => tabLabel(t))).toEqual(['All done', 'Worked', 'Unfilled', 'Cancelled']);
    expect(stagePill('worked')).toEqual({ label: 'Worked', cls: 'qst-worked' });
    expect(stagePill('not_refilled')).toEqual({ label: 'Pulled out · unfilled', cls: 'qst-unfilled' });
    expect(stagePill('unconfirmed').label).toBe('Never confirmed');
    const w = { client: 'Customer', worker: 'Worker', bank: 'bank', shifts: 'shifts' };
    expect(stagePill('cancelled', w, 'client_withdrew')).toEqual({ label: 'Customer withdrew', cls: 'qst-cancelled' });
    expect(['client_cancelled', 'not_filled', 'our_mistake', 'other', null].map(k => cancelPillLabel(k))).toEqual(['Client cancelled', 'Couldn’t fill', 'Our mistake', 'Cancelled', 'Cancelled']);
    expect(dayHeading({ date: '2026-11-03', total: 248, worked: 231, unfilled: 9, cancelled: 8 })).toBe('Tue 3 Nov · 248 · 231 worked · 9 unfilled · 8 cancelled');
    expect(dayHeading({ date: '2026-10-31', total: 5, worked: 5, unfilled: 0, cancelled: 0 })).toBe('Sat 31 Oct · 5 · 5 worked');
    expect(dayGroups([{ localDate: '2026-10-31', id: 1 }, { localDate: '2026-10-31', id: 2 }, { localDate: '2026-10-30', id: 3 }]).map(g => [g.date, g.rows.length]))
      .toEqual([['2026-10-31', 2], ['2026-10-30', 1]]);
  });

  it('lists office chips: the person’s own first, All, each office, then No office', () => {
    const offices = [{ id: 'a', name: 'VIC Melbourne Metro', count: 3, mine: true }, { id: 'b', name: 'QLD Sunshine Coast', count: 2, mine: false }];
    expect(officeChipList({ office: 'mine', myOffices: ['a'], offices, noOffice: 1 })).toEqual([
      { label: 'My office', value: null, count: 3, on: true },
      { label: 'All', value: 'all', count: 6, on: false },
      { label: 'VIC Melbourne Metro', value: 'a', count: 3, on: false },
      { label: 'QLD Sunshine Coast', value: 'b', count: 2, on: false },
      { label: 'No office', value: 'none', count: 1, on: false },
    ]);
    // Nobody's offices: All is the default; No office only when it has work.
    const plain = officeChipList({ office: 'b', myOffices: [], offices: offices.map(o => ({ ...o, mine: false })), noOffice: 0 });
    expect(plain.map(c => [c.label, c.value, c.on])).toEqual([['All', null, false], ['VIC Melbourne Metro', 'a', false], ['QLD Sunshine Coast', 'b', true]]);
    expect(officeChipList({ office: null, myOffices: [], offices: [], noOffice: 4 })).toEqual([]);
  });

  it('picks the best people for the panel and words their line', () => {
    const c = (name: string, eligible: boolean, offer: string | null = null) => ({ name, eligible, offer: offer ? { status: offer } : null });
    const list = [c('A', true), c('B', true, 'pending'), c('C', false), c('D', true, 'declined'), c('E', true), c('F', true), c('G', true), c('H', true)];
    expect(bestPeople(list).map(x => x.name)).toEqual(['A', 'D', 'E', 'F', 'G']);
    expect(bestPeople(list, 2).map(x => x.name)).toEqual(['A', 'D']);
    expect(bestPeople(list, 2, 'A').map(x => x.name)).toEqual(['D', 'E']); // the person who pulled out isn't suggested again
    expect(personLine({ eligible: true, weekHours: 24, warnings: [], blocks: [] })).toBe('Ready · 24 h that week');
    expect(personLine({ eligible: true, weekHours: 16, warnings: [{ message: 'Only 9 hours’ rest' }, { message: 'x' }], blocks: [] }))
      .toBe('Warning: Only 9 hours’ rest (+1) · 16 h that week');
    expect(personLine({ eligible: false, weekHours: 0, warnings: [], blocks: [{ message: 'On leave' }] })).toBe('On leave');
    expect(initials('Oscar Diaz')).toBe('OD');
  });

  it('says who has worked at the site before', () => {
    expect(hereLine({ shiftsHere: 3, lastHere: '2026-09-22' }, '2026-11-02')).toBe('Worked here 3 times · last 22 Sep');
    expect(hereLine({ shiftsHere: 2, lastHere: '2026-10-01' }, '2026-11-02')).toBe('Worked here twice · last 1 Oct');
    expect(hereLine({ shiftsHere: 1, lastHere: '2025-12-04' }, '2026-11-02')).toBe('Worked here once · last 4 Dec 2025');
    expect(hereLine({ shiftsHere: 0, lastHere: null }, '2026-11-02')).toBe('New to this site');
    expect(hereLine(undefined, '2026-11-02', 'location')).toBe('New to this location');
  });

  it('releases several new shifts at once', () => {
    const rows = [
      { id: '1', stage: 'new' as const }, { id: '2', stage: 'released' as const }, { id: '3', stage: 'pulled_out' as const }, { id: '4', stage: 'new' as const },
    ];
    expect(releasableRows(rows).map(r => r.id)).toEqual(['1', '4']);
    expect(releasableRows(Array.from({ length: 30 }, (_, i) => ({ id: String(i), stage: 'new' as const })))).toHaveLength(BULK_MAX);
    const c = (n: string, eligible = true, status?: string) => ({ workerId: `w${n}`, name: n, eligible, offer: status ? { status } : null });
    const cands = [c('A'), c('B', false), c('C', true, 'pending'), c('D'), c('E', true, 'declined'), ...Array.from({ length: 60 }, (_, i) => c(`x${i}`))];
    expect(releasePick(cands, 'top', null)).toEqual(['wA', 'wD', 'wE', 'wx0', 'wx1']);
    expect(releasePick(cands, 'release', 'A')).toHaveLength(50);
    expect(releasePick(cands, 'release', 'A')).not.toContain('wA');
  });

  it('words the result of releasing several', () => {
    expect(bulkReleaseMessage([{ label: 'Tuesday 3 November 07:00 Carer', offered: 12 }, { label: 'Tuesday 3 November 15:00 Carer', offered: 1 }]))
      .toEqual({ ok: true, text: 'Released 2 shifts to the bank: 13 offers sent. The first to accept each one gets it.' });
    expect(bulkReleaseMessage([{ label: 'Tue 07:00 Cook', offered: 1 }, { label: 'Tue 09:00 Cook', offered: 0, reason: 'Nobody else can work it' }],
      { bank: 'casual pool', shift: 'job', shifts: 'jobs' }).text)
      .toBe('Released 1 job to the casual pool: 1 offer sent. The first to accept each one gets it. Not released (1): Tue 09:00 Cook: Nobody else can work it.');
    expect(bulkReleaseMessage([{ label: 'X', offered: 0, reason: 'Someone is on it now.' }]))
      .toEqual({ ok: false, text: 'Nothing released. Not released (1): X: Someone is on it now.' });
    const many = Array.from({ length: 7 }, (_, i) => ({ label: `S${i}`, offered: 0, reason: 'Already offered' }));
    expect(bulkReleaseMessage([{ label: 'ok', offered: 3 }, ...many]).text).toContain('S4: Already offered; and 2 more.');
  });
});

describe('distance from home on the fill panel (David, 4 Nov)', () => {
  const p = (name: string, distanceKm: number | null, eligible = true) => ({ workerId: name, name, eligible, distanceKm, offer: null });
  it('words the best person line with the distance first', () => {
    expect(nearHereLine(12.4, 'Worked here 3 times · last 22 Sep')).toBe('12 km · Worked here 3 times · last 22 Sep');
    expect(nearHereLine(null, 'New to this site')).toBe('New to this site');
    expect(nearHereLine(0.2, 'New to this site')).toBe('<1 km · New to this site');
  });
  it('sorts nearest first only when asked, unknown last, otherwise the API order', () => {
    const list = [p('A', 30), p('B', null), p('C', 5), p('D', 30), p('E', 2, false)];
    expect(nearestFirst(list).map(x => x.name)).toEqual(['E', 'C', 'A', 'D', 'B']);
    expect(bestPeople(list).map(x => x.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(bestPeople(list, 5, null, true).map(x => x.name)).toEqual(['C', 'A', 'D', 'B']);
    expect(releasePick(list, 'top', null, true)).toEqual(['C', 'A', 'D', 'B']);
  });
  it('keeps Nearest first in the URL', () => {
    const q = parseQueueParams({ near: '1', shift: '00000000-0000-4000-8000-000000000001' });
    expect(q.near).toBe(true);
    expect(queueHref(q)).toContain('near=1');
    expect(queueHref(q, { near: false })).not.toContain('near');
  });
});

describe('best people from one standing team (6 Nov)', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002';
  const teams = [
    { id: A, name: 'Demolition', members: [
      { workerId: 'w1', role: 'Carpenter', startsOn: '2026-11-01', endsOn: null },
      { workerId: 'w2', role: 'Labourer', startsOn: '2026-11-10', endsOn: null },
      { workerId: 'w3', role: 'Painter', startsOn: '2026-10-01', endsOn: '2026-11-05' },
    ] },
    { id: B, name: 'Build', members: [{ workerId: 'w4', role: 'Plasterer', startsOn: '2026-12-01', endsOn: null }] },
  ];

  it('keeps the team in the URL', () => {
    const p = parseQueueParams({ shift: A, crew: A.toUpperCase() });
    expect(p.crew).toBe(A);
    expect(queueHref(p)).toContain(`crew=${A}`);
    expect(queueHref(p, { crew: null })).not.toContain('crew');
    expect(parseQueueParams({ crew: 'nope' }).crew).toBeNull();
  });

  it('finds who is on the team on the shift’s date', () => {
    expect([...teamOn(teams, A, '2026-11-06')!]).toEqual([['w1', 'Carpenter']]);
    expect([...teamOn(teams, A, '2026-11-05')!.keys()]).toEqual(['w1', 'w3']);
    expect([...teamOn(teams, A, '2026-11-10')!.keys()]).toEqual(['w1', 'w2']);
    expect(teamOn(teams, null, '2026-11-06')).toBeNull();
    expect(teamOn(teams, 'gone', '2026-11-06')).toBeNull();
  });

  it('offers teams with people that day, keeping the chosen one', () => {
    expect(teamChoicesOn(teams, '2026-11-06', null)).toEqual([{ id: A, label: 'Demolition', count: 1 }]);
    expect(teamChoicesOn(teams, '2026-11-06', B).map(t => t.label)).toEqual(['Build', 'Demolition']);
    expect(teamChoicesOn(teams, '2026-12-01', null).map(t => t.label)).toEqual(['Build', 'Demolition']);
  });

  it('narrows the candidates only when a team is chosen', () => {
    const cands = [{ workerId: 'w1' }, { workerId: 'w9' }];
    expect(inTeam(cands, null)).toEqual(cands);
    expect(inTeam(cands, teamOn(teams, A, '2026-11-06'))).toEqual([{ workerId: 'w1' }]);
    expect(inTeam(cands, teamOn(teams, B, '2026-11-06'))).toEqual([]);
  });
});
