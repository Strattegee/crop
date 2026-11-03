import { describe, expect, it } from 'vitest';
import { addedMessage, dayTotals, periodLetter, templateGrid, templateHref, templateShiftBody, type TemplateShift } from '../lib/roster-template';

const shift = (over: Partial<TemplateShift>): TemplateShift => ({
  id: 'x', weekday: 1, startTime: '07:00', endTime: '15:00', breakMinutes: 30, role: 'Chef', areaId: null, areaName: null,
  shiftCodeId: null, shiftCode: null, shiftLetter: null, equipmentOnly: false, notes: null, genderRequested: null,
  workerId: null, workerName: null, equipmentList: [], duties: [], ...over,
});

const form = (pairs: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.append(k, v);
  return fd;
};

describe('the Template tab', () => {
  it('lays a template out as a week by area, empty areas included and "No area" last', () => {
    const rows = templateGrid([
      shift({ id: 'b', weekday: 2, startTime: '10:00', areaId: 'k', areaName: 'Kitchen' }),
      shift({ id: 'a', weekday: 2, startTime: '07:00', areaId: 'k', areaName: 'Kitchen' }),
      shift({ id: 'c', weekday: 7 }),
    ], [{ id: 'k', name: 'Kitchen' }, { id: 'b', name: 'Bar' }]);
    expect(rows.map(r => r.label)).toEqual(['Bar', 'Kitchen', 'No area']);
    expect(rows[1].days[1].map(s => s.id)).toEqual(['a', 'b']);
    expect(rows[2].days[6].map(s => s.id)).toEqual(['c']);
    expect(templateGrid([], []).map(r => r.label)).toEqual(['No area']);
  });

  it('totals each day, overnight shifts included', () => {
    const t = dayTotals([shift({}), shift({ startTime: '22:00', endTime: '06:00', breakMinutes: 0 }), shift({ weekday: 3 })]);
    expect(t[0]).toEqual({ shifts: 2, hours: 15.5 });
    expect(t[2]).toEqual({ shifts: 1, hours: 7.5 });
    expect(t[6]).toEqual({ shifts: 0, hours: 0 });
  });

  it('gives A, P or N from the start time', () => {
    expect([periodLetter('05:00'), periodLetter('11:59'), periodLetter('12:00'), periodLetter('19:00'), periodLetter('04:00')]).toEqual(['A', 'A', 'P', 'N', 'N']);
  });

  it('turns the panel form into the API body', () => {
    expect(templateShiftBody(form([['weekdays', '1'], ['weekdays', '3'], ['startTime', '07:00'], ['endTime', '15:00'], ['breakMinutes', '30'],
      ['role', 'Chef'], ['areaId', ''], ['workerId', 'w1'], ['dutyIds', 'd1']]), true)).toEqual({
      weekdays: [1, 3], startTime: '07:00', endTime: '15:00', breakMinutes: 30, role: 'Chef', areaId: null, shiftCodeId: null, equipmentOnly: false,
      workerId: 'w1', genderRequested: null, notes: null, dutyIds: ['d1'], equipmentIds: [],
    });
    const eq = templateShiftBody(form([['weekday', '5'], ['equipmentOnly', 'on'], ['role', 'Chef'], ['workerId', 'w1'], ['equipmentIds', 'e1'], ['shiftCodeId', 'c1']]), false);
    expect(eq).toMatchObject({ weekday: 5, equipmentOnly: true, role: null, workerId: null, shiftCodeId: 'c1', startTime: null, breakMinutes: null, equipmentIds: ['e1'] });
  });

  it('words what was added and builds its addresses', () => {
    const count = (n: number) => `${n} ${n === 1 ? 'job' : 'jobs'}`;
    expect(addedMessage([3, 1, 2], count)).toBe('3 jobs added to Mon, Tue and Wed.');
    expect(addedMessage([7], count)).toBe('1 job added to Sun.');
    expect(templateHref('s1', 't1', { slot: 'x', add: null })).toBe('/roster/template?site=s1&template=t1&slot=x');
    expect(templateHref(null, null)).toBe('/roster/template');
  });
});
