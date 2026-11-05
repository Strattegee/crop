import { describe, expect, it } from 'vitest';
import {
  dayLabel, hoursLine, hoursNote, moveMessage, namedWords, outsideNote, rosteredLine, rosterMessage, stagePicker, timelineBars, timelineSpan, timelineTicks, todayAt, weekdaysFromForm,
} from '../lib/project-stages';

describe('project stages (David, 5 Nov)', () => {
  it('reads working days from the form, Monday to Friday by default', () => {
    expect(weekdaysFromForm(k => ({ wd_1: 'on', wd_6: 'on' } as Record<string, string>)[k])).toEqual([1, 6]);
    expect(weekdaysFromForm(() => undefined)).toEqual([1, 2, 3, 4, 5]);
    expect(dayLabel('2026-11-09')).toBe('Mon 9 Nov');
  });

  it('words hours, people and what has been rostered', () => {
    expect(hoursLine({ startTime: '07:00', endTime: '15:30', breakMinutes: 30, shiftCode: null, ownTimes: true })).toBe('07:00–15:30 · 30 min break');
    expect(hoursLine({ startTime: '22:00', endTime: '06:00', breakMinutes: 0, shiftCode: 'NIGHT', ownTimes: false })).toBe('NIGHT (22:00–06:00 (overnight))');
    const p = (active = true) => ({ id: 'x', workerId: 'w', name: 'Ana', role: 'Carpenter', active, status: 'active', roleMissing: false, supervisor: false });
    expect(namedWords({ needed: 4, people: [p(), p(), p(false)] })).toBe('2 of 4 named');
    expect(namedWords({ needed: 0, people: [p()] })).toBe('1 named');
    expect(namedWords({ needed: 3, people: [] })).toBe('No one named yet');
    expect(rosteredLine({ shifts: 12, open: 4, days: 4, outside: 0, outsideMovable: 0, offHours: 0, offHoursMovable: 0 }, 'shifts')).toBe('12 shifts made over 4 days · 4 open');
    expect(rosteredLine({ shifts: 0, open: 0, days: 0, outside: 0, outsideMovable: 0, offHours: 0, offHoursMovable: 0 }, 'shifts')).toBeNull();
  });

  it('lays stages out on lanes so overlaps show', () => {
    const view = { project: { id: 'p', name: 'Beach Hut', startsOn: '2026-11-09', endsOn: '2026-11-28', timezone: 'Australia/Melbourne' }, span: { from: '2026-11-09', to: '2026-11-30' } };
    const span = timelineSpan(view)!;
    expect(span).toEqual({ from: '2026-11-09', to: '2026-11-30', days: 22 });
    expect(timelineSpan({ ...view, span: null })).toBeNull();
    const { bars, lanes } = timelineBars([
      { id: 'c', name: 'Clean', startsOn: '2026-11-25', endsOn: '2026-11-26', overlaps: ['Build'] },
      { id: 'a', name: 'Demolition', startsOn: '2026-11-09', endsOn: '2026-11-12', overlaps: [] },
      { id: 'b', name: 'Build', startsOn: '2026-11-13', endsOn: '2026-11-25', overlaps: ['Clean'] },
    ], span);
    expect(lanes).toBe(2);
    expect(bars.map(b => `${b.name}:${b.lane}`)).toEqual(['Demolition:0', 'Build:0', 'Clean:1']);
    expect(bars[0]).toMatchObject({ left: 0, width: 18.18, overlaps: false });
    expect(bars[2].overlaps).toBe(true);
    expect(timelineTicks(span).map(t => t.label)).toEqual(['9 Nov', '16 Nov', '23 Nov', '30 Nov']);
    expect(timelineTicks({ from: '2026-11-11', to: '2026-11-20', days: 10 }).map(t => t.date)).toEqual(['2026-11-11', '2026-11-16']);
    expect(todayAt(span, '2026-11-09')).toBe(2.27);
    expect(todayAt(span, '2026-12-09')).toBeNull();
  });

  it('says what rostering made and what was left open', () => {
    const r = {
      created: 3, assigned: 1, alreadyRostered: 0, pastDays: 0, supervisorCreated: 0, supervisorAssigned: 0, summary: 'Created 3 shifts: 1 with their person, 2 left open.',
      leftOpen: [
        { date: '2026-11-09', startTime: '07:00', role: 'Carpenter', workerName: null, reason: 'Nobody named for this place' },
        { date: '2026-11-10', startTime: '07:00', role: 'Cleaner', workerName: 'Dee Example', reason: 'Dee Example is on leave' },
      ],
    };
    expect(rosterMessage(r)).toBe('Created 3 shifts: 1 with their person, 2 left open. Left open: Mon 9 Nov 07:00 Carpenter: Nobody named for this place; Tue 10 Nov 07:00 Cleaner (Dee Example): Dee Example is on leave');
    expect(rosterMessage(r, 1)).toMatch(/… and 1 more\.$/);
    expect(rosterMessage({ ...r, leftOpen: [] })).toBe(r.summary);
  });

  it('offers people by role, make-up roles first and short ones marked', () => {
    const groups = stagePicker(
      { roles: [{ role: 'Plasterer', count: 2 }], people: [{ id: 's', workerId: 'cy', name: 'Cy', role: 'Plasterer', active: true, status: 'active', roleMissing: false, supervisor: false }] },
      [{ id: 'cy', name: 'Cy', roles: ['Plasterer'] }, { id: 'zo', name: 'Zo', roles: ['Plasterer', 'Painter'] }, { id: 'al', name: 'Al', roles: ['Painter'] }],
    );
    expect(groups.map(g => `${g.label}:${g.options.map(o => o.label).join(',')}`)).toEqual(['Plasterer (short 1):Zo', 'Painter (not in the make-up):Al,Zo']);
    expect(groups[0].options[0].value).toBe('zo|Plasterer');
  });

  it('says what moving a stage\'s shifts would do, and what it did', () => {
    expect(outsideNote({ outside: 0, outsideMovable: 0 })).toBeNull();
    expect(outsideNote({ outside: 3, outsideMovable: 3 })).toEqual({ movable: 3, stay: 0, stayLine: null });
    expect(outsideNote({ outside: 3, outsideMovable: 2 })?.stayLine).toBe("1 is in a published week, started or with an agency's person: change it on the roster.");
    const kept = { started: 0, agency: 0, published: 0 };
    expect(moveMessage(null, null)).toBeNull();
    expect(moveMessage({ cancelled: 1, kept, roster: null }, 'Took 1 shift off.')).toBe('Took 1 shift off.');
    const roster = { created: 1, assigned: 0, alreadyRostered: 0, pastDays: 0, supervisorCreated: 0, supervisorAssigned: 0,
      leftOpen: [{ date: '2026-11-13', startTime: '07:00', role: 'Carpenter', workerName: null, reason: 'Nobody named for this place' }] };
    expect(moveMessage({ cancelled: 1, kept, roster }, 'Done.')).toBe('Done. Left open: Fri 13 Nov 07:00 Carpenter: Nobody named for this place');
    // New hours: the people taken off, with the reason.
    const takenOff = [{ date: '2026-11-11', startTime: '06:00', role: 'Carpenter', workerName: 'Ana Example', reason: 'Already rostered 05:00–06:30' }];
    expect(moveMessage({ cancelled: 0, kept, roster: null, retimed: 3, takenOff }, 'Changed 3 shifts.'))
      .toBe('Changed 3 shifts. Taken off for the new hours: Wed 11 Nov 06:00 Carpenter (Ana Example): Already rostered 05:00–06:30');
    expect(hoursNote({ offHours: 0, offHoursMovable: 0 })).toBeNull();
    expect(hoursNote({ offHours: 4, offHoursMovable: 4 })).toEqual({ movable: 4, stay: 0, stayLine: null });
    expect(hoursNote({ offHours: 4, offHoursMovable: 3 })?.stayLine).toBe("1 is in a published week or with an agency's person: change it on the roster.");
  });
});
