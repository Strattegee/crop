import { describe, expect, it } from 'vitest';
import { bestPeople, crewChoices, crewDuring, multiAssignMessage, parseStripFilter, pickedInOrder, reasonFor, teamDuring, withStripFilter, type MenuCandidate } from '../app/(office)/roster/view';

describe('strip filters in the roster URL', () => {
  it('reads role and hours left', () => {
    expect(parseStripFilter({ role: 'Barista', hours: 'left' })).toEqual({ role: 'Barista', hoursLeft: true, team: false, crew: '' });
    expect(parseStripFilter({})).toEqual({ role: '', hoursLeft: false, team: false, crew: '' });
    expect(parseStripFilter({ team: '1' }).team).toBe(true);
    expect(parseStripFilter({ team: 'yes' }).team).toBe(false);
    expect(parseStripFilter({ role: '  ', hours: 'yes' })).toEqual({ role: '', hoursLeft: false, team: false, crew: '' });
  });

  it('sets and clears them, keeping the rest of the view and dropping old messages', () => {
    const u = withStripFilter('/roster?week=2026-11-02&view=area&shift=abc&done=Assigned', { role: 'Barista', hoursLeft: true, team: false, crew: '' });
    const p = new URL(u, 'http://x').searchParams;
    expect(p.get('role')).toBe('Barista');
    expect(p.get('hours')).toBe('left');
    expect(p.get('week')).toBe('2026-11-02');
    expect(p.get('shift')).toBe('abc');
    expect(p.get('done')).toBeNull();
    expect(withStripFilter(u, { role: '', hoursLeft: false, team: false, crew: '' })).toBe('/roster?week=2026-11-02&view=area&shift=abc');
  });

  it('keeps roles with spaces and ampersands intact', () => {
    const u = withStripFilter('/roster', { role: 'Kitchen hand & porter', hoursLeft: false, team: false, crew: '' });
    expect(parseStripFilter({ role: new URL(u, 'http://x').searchParams.get('role') ?? undefined }).role).toBe('Kitchen hand & porter');
  });

  it('never leaves the roster', () => {
    expect(withStripFilter('https://evil.example/x', { role: 'A', hoursLeft: false, team: false, crew: '' })).toBe('/roster?role=A');
  });
});

describe('the site team on the strip', () => {
  it('keeps team=1 in the URL and drops it when cleared', () => {
    const u = withStripFilter('/roster?week=2026-11-02&site=s1', { role: '', hoursLeft: false, team: true, crew: '' });
    expect(new URL(u, 'http://x').searchParams.get('team')).toBe('1');
    expect(withStripFilter(u, { role: '', hoursLeft: false, team: false, crew: '' })).toBe('/roster?week=2026-11-02&site=s1');
  });

  it('counts people on the team at any time in the dates on screen', () => {
    const t = teamDuring([
      { workerId: 'a', teamRole: 'worker', from: '2026-10-01', to: null },
      { workerId: 'b', teamRole: 'worker', from: '2026-11-08', to: null }, // starts on the Sunday
      { workerId: 'c', teamRole: 'worker', from: '2026-09-01', to: '2026-11-01' }, // left the day before
      { workerId: 'd', teamRole: 'worker', from: '2026-11-09', to: null }, // starts next week
      { workerId: 'e', teamRole: 'supervisor', from: '2026-10-01', to: '2026-11-02' }, // last day is the Monday
    ], '2026-11-02', '2026-11-08');
    expect([...t.keys()].sort()).toEqual(['a', 'b', 'e']);
    expect(t.get('e')).toBe('supervisor');
  });

  it('prefers supervisor when someone has two entries in the period', () => {
    const t = teamDuring([
      { workerId: 'a', teamRole: 'supervisor', from: '2026-11-01', to: '2026-11-03' },
      { workerId: 'a', teamRole: 'worker', from: '2026-11-04', to: null },
    ], '2026-11-02', '2026-11-08');
    expect(t.get('a')).toBe('supervisor');
  });
});

describe('assigning one person to several shifts', () => {
  it('puts the picks in date order and adds times only when two share a day', () => {
    expect(pickedInOrder([
      { id: 'c', date: '2026-11-06', start: '07:00' },
      { id: 'a', date: '2026-11-04', start: '13:00' },
      { id: 'b', date: '2026-11-04', start: '06:00' },
    ]).map(p => [p.id, p.label])).toEqual([['b', 'Wed 4 Nov 06:00'], ['a', 'Wed 4 Nov 13:00'], ['c', 'Fri 6 Nov']]);
  });

  it('words reasons without repeating the name', () => {
    expect(reasonFor('Sol Oakley', 'Sol Oakley is already rostered 07:00–15:00 at The Grand Café')).toBe('already rostered 07:00–15:00 at The Grand Café');
    expect(reasonFor('Sol Oakley', "Sol Oakley doesn't have the role Barista. Sol Oakley is on leave.")).toBe("doesn't have the role Barista; on leave");
    expect(reasonFor('Sol Oakley', "Sol Oakley's visa allows 48 hours a fortnight")).toBe("Sol Oakley's visa allows 48 hours a fortnight");
    expect(reasonFor('Sol Oakley', 'Someone is already on this shift. Remove them first.')).toBe('Someone is already on this shift; Remove them first');
  });

  const count = (n: number) => `${n} ${n === 1 ? 'shift' : 'shifts'}`;
  it('says how many went on and which did not, with why', () => {
    expect(multiAssignMessage('Sol Oakley', [
      { label: 'Wed 4 Nov', ok: true }, { label: 'Thu 5 Nov', ok: true }, { label: 'Sat 7 Nov', ok: true },
      { label: 'Fri 6 Nov', ok: false, message: 'Sol Oakley is already rostered 07:00–15:00 at Bay St' },
    ], count)).toEqual({ done: 'Assigned Sol Oakley to 3 shifts. Confirm once they have agreed. Not assigned: Fri 6 Nov (already rostered 07:00–15:00 at Bay St).' });
    expect(multiAssignMessage('Sol Oakley', [{ label: 'Wed 4 Nov', ok: true }, { label: 'Thu 5 Nov', ok: true }], count))
      .toEqual({ done: 'Assigned Sol Oakley to 2 shifts. Confirm once they have agreed.' });
  });

  it('is an error when none went on', () => {
    expect(multiAssignMessage('Sol Oakley', [{ label: 'Wed 4 Nov', ok: false, message: "Sol Oakley doesn't have the role Barista" }], count))
      .toEqual({ error: "Sol Oakley wasn't assigned. Not assigned: Wed 4 Nov (doesn't have the role Barista)." });
  });
});

describe('best people for the right-click menu', () => {
  const c = (workerId: string, weekHours: number, eligible = true, warn?: string, block?: string): MenuCandidate => ({
    workerId, name: `Person ${workerId}`, weekHours, eligible, warnings: warn ? [{ message: warn }] : [], blocks: block ? [{ message: block }] : [],
  });

  it('keeps the API order for one shift, ready people first and blocked ones last', () => {
    const r = bestPeople([[c('a', 4), c('b', 10, true, 'Person b is on leave requested'), c('x', 0, false, undefined, 'Person x doesn\'t have the role Barista')]]);
    expect(r.map(p => [p.workerId, p.blocked, p.note])).toEqual([
      ['a', false, null], ['b', false, 'on leave requested'], ['x', true, "doesn't have the role Barista"],
    ]);
  });

  it('shows the top five who can work it and up to three who cannot', () => {
    const list = [...'abcdefg'].map((id, i) => c(id, i)).concat([...'wxyz'].map(id => c(id, 0, false)));
    const r = bestPeople([list]);
    expect(r.filter(p => !p.blocked).map(p => p.workerId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.filter(p => p.blocked)).toHaveLength(3);
  });

  it('for several shifts puts people who can do all of them first', () => {
    const r = bestPeople([
      [c('a', 2), c('b', 8)],
      [c('a', 2, false, undefined, 'Person a is already rostered 07:00–15:00 at Bay St'), c('b', 8)],
    ]);
    expect(r.map(p => [p.workerId, p.canDo, p.note])).toEqual([['b', 2, null], ['a', 1, 'can do 1 of 2; already rostered 07:00–15:00 at Bay St']]);
  });

  it('adds past work at the site only when asked (every shift at one site)', () => {
    const a = { ...c('a', 2), siteHistory: { shiftsHere: 3, lastHere: '2026-09-22' } };
    const b = { ...c('b', 4), siteHistory: { shiftsHere: 0, lastHere: null } };
    const r = bestPeople([[a, b]], 5, 3, { today: '2026-11-02', site: 'venue' });
    expect(r.map(p => [p.workerId, p.here, p.knowsSite])).toEqual([
      ['a', 'Worked here 3 times · last 22 Sep', true], ['b', 'New to this venue', false],
    ]);
    expect(bestPeople([[a, b]]).map(p => p.here)).toEqual([null, null]); // several sites: no line
    expect(bestPeople([[a, b]]).every(p => !p.knowsSite)).toBe(true);
  });

  it('adds the distance from home with one site, without changing the order (4 Nov)', () => {
    const a = { ...c('a', 2), distanceKm: 140.2 };
    const b = { ...c('b', 4), distanceKm: 0.4 };
    const d = { ...c('d', 5), distanceKm: null };
    const r = bestPeople([[a, b, d]], 5, 3, { today: '2026-11-04', site: 'site' });
    expect(r.map(p => [p.workerId, p.distance])).toEqual([['a', '140 km'], ['b', '<1 km'], ['d', null]]);
    expect(bestPeople([[a, b]]).map(p => p.distance)).toEqual([null, null]); // several sites: no distance
  });

  it('keeps the order when someone knows the site (display only)', () => {
    const a = { ...c('a', 2), siteHistory: { shiftsHere: 0, lastHere: null } };
    const b = { ...c('b', 9), siteHistory: { shiftsHere: 5, lastHere: '2026-10-30' } };
    expect(bestPeople([[a, b]], 5, 3, { today: '2026-11-02', site: 'site' }).map(p => p.workerId)).toEqual(['a', 'b']);
  });
});

describe('standing team filter on the strip (6 Nov)', () => {
  const id = '0b1c2d3e-4f50-4a1b-8c2d-3e4f5a6b7c8d';
  it('reads a team id from the URL and keeps it in strip URLs', () => {
    expect(parseStripFilter({ crew: id.toUpperCase() }).crew).toBe(id);
    expect(parseStripFilter({ crew: 'build' }).crew).toBe('');
    const u = withStripFilter('/roster?week=2026-11-02&done=Saved', { role: '', hoursLeft: false, team: false, crew: id });
    expect(u).toBe(`/roster?week=2026-11-02&crew=${id}`);
    expect(withStripFilter(u, { role: '', hoursLeft: false, team: false, crew: '' })).toBe('/roster?week=2026-11-02');
  });
  const teams = [
    { id, name: 'Build', members: [
      { workerId: 'a', role: 'Carpenter', startsOn: '2026-10-01', endsOn: null },
      { workerId: 'b', role: 'Plasterer', startsOn: '2026-11-09', endsOn: null },
      { workerId: 'c', role: 'Painter', startsOn: '2026-09-01', endsOn: '2026-11-01' },
      { workerId: 'd', role: 'Labourer', startsOn: '2026-09-01', endsOn: '2026-11-03' },
    ] },
    { id: 'x', name: 'Cleaning', members: [] },
    { id: 'y', name: 'Assembly', members: [{ workerId: 'a', role: 'Carpenter', startsOn: '2026-01-01', endsOn: null }] },
  ];
  it('gives the team\'s people in the dates on screen with their role in it', () => {
    const m = crewDuring(teams, id, '2026-11-02', '2026-11-08');
    expect([...m.entries()]).toEqual([['a', 'Carpenter'], ['d', 'Labourer']]);
    expect(crewDuring(teams, id, '2026-11-09', '2026-11-15').has('b')).toBe(true);
    expect(crewDuring(teams, 'nope', '2026-11-02', '2026-11-08').size).toBe(0);
  });
  it('offers teams with people in them, by name', () => {
    expect(crewChoices(teams)).toEqual([{ id: 'y', label: 'Assembly' }, { id, label: 'Build' }]);
  });
});
