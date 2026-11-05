import { describe, expect, it } from 'vitest';
import {
  dayLabel, hoursLine, namedWords, rosteredLine, rosterMessage, stagePicker, timelineBars, timelineSpan, timelineTicks, todayAt, weekdaysFromForm,
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
    expect(rosteredLine({ shifts: 12, open: 4, days: 4, outside: 0 }, 'shifts')).toBe('12 shifts made over 4 days · 4 open');
    expect(rosteredLine({ shifts: 0, open: 0, days: 0, outside: 0 }, 'shifts')).toBeNull();
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
});
