import { describe, expect, it } from 'vitest';
import {
  QUEUE_TABS, bandTitle, bestPeople, hereLine, initials, parseQueueParams, personLine, queueHref, shortSpan, stagePill, startsIn, tabLabel, updatedWords, waitingFor,
} from '../lib/allocation-queue';

const NOW = Date.parse('2026-11-02T08:00:00Z');
const MIN = 60_000;

describe('allocation queue (David chose layout A, 2 Nov)', () => {
  it('labels tabs and stages in the business’s words', () => {
    expect(QUEUE_TABS.map(t => tabLabel(t))).toEqual(['All needing someone', 'New', 'Released to bank', 'Accepted · confirm', 'Worker to confirm',
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
    expect(p).toEqual({ stage: 'released', region: 'VIC', clientId: null, days: 7, shift: id, view: 'queue' });
    expect(parseQueueParams({})).toEqual({ stage: 'all', region: null, clientId: null, days: 3, shift: null, view: 'queue' });
    expect(parseQueueParams({ stage: 'bogus', days: '5' })).toMatchObject({ stage: 'all', days: 3 });
    expect(queueHref(p)).toBe(`/allocations?stage=released&region=VIC&days=7&shift=${id}`);
    expect(queueHref(p, { shift: null, stage: 'all' })).toBe('/allocations?region=VIC&days=7');
    expect(queueHref(parseQueueParams({}))).toBe('/allocations');
    expect(queueHref(parseQueueParams({}), { view: 'new' })).toBe('/allocations?view=new');
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
});
