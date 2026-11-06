import { describe, expect, it } from 'vitest';
import {
  addressLine, equipmentLine, memberLine, projectAlerts, projectCounts, projectDayLine, projectLine, projectOrder, stockLine, teamShown,
  type ProjectEquipment, type ProjectMember, type ProjectRow,
} from '../src/projects';

const word = { one: 'Shift', many: 'Shifts', lower: 'shift', lowerMany: 'shifts' };
const kit = { one: 'Plant', many: 'Plant', lower: 'plant', lowerMany: 'plant' };

function row(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p1', name: 'Example Street', code: null, status: 'active', statusLabel: 'Active', dates: '3 Nov – 20 Mar', clientName: 'Example Builders',
    managerName: null, teamSize: 4, shiftsThisWeek: 12, unfilledThisWeek: 1, unfilledNext7: 2, equipmentCount: 1, ...over,
  };
}

function member(over: Partial<ProjectMember> = {}): ProjectMember {
  return { id: 'm1', workerId: 'w1', name: 'Sam Example', teamRole: 'worker', areaName: null, state: 'current', line: 'No end date', ...over };
}

function equipment(over: Partial<ProjectEquipment> = {}): ProjectEquipment {
  return { id: 'e1', equipmentName: 'EX-01', typeName: 'Excavator', equipmentStatus: 'active', areaName: 'Bay 2', state: 'current', line: 'Until 20 Mar', checkState: 'ok', ...over };
}

describe('projects in manager mode', () => {
  it('describes a project in the list', () => {
    expect(projectLine(row())).toBe('Example Builders · Active · 3 Nov – 20 Mar');
    expect(projectLine(row({ clientName: null, dates: null }))).toBe('Active');
    expect(projectCounts(row(), word)).toBe('4 on the team · 12 shifts this week · 2 unfilled in the next 7 days');
    expect(projectCounts(row({ teamSize: 0, shiftsThisWeek: 1, unfilledNext7: 0 }), word)).toBe('1 shift this week');
    expect(projectCounts(row({ teamSize: 0, shiftsThisWeek: 0, unfilledNext7: 0 }), { ...word, lowerMany: 'jobs' })).toBe('No jobs this week');
  });

  it('puts projects with unfilled shifts first and otherwise keeps the order', () => {
    const list = [row({ id: 'a', unfilledNext7: 0 }), row({ id: 'b', unfilledNext7: 3 }), row({ id: 'c', unfilledNext7: 0 }), row({ id: 'd', unfilledNext7: 1 })];
    expect(projectOrder(list).map(p => p.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('words today and tomorrow', () => {
    expect(projectDayLine({ day: '2026-11-06', rostered: 5, filled: 4, unfilled: 1 }, '2026-11-06', word)).toBe('Today: 5 shifts · 4 filled · 1 unfilled');
    expect(projectDayLine({ day: '2026-11-07', rostered: 1, filled: 1, unfilled: 0 }, '2026-11-06', word)).toBe('Tomorrow: 1 shift · 1 filled');
    expect(projectDayLine({ day: '2026-11-07', rostered: 0, filled: 0, unfilled: 0 }, '2026-11-06', word)).toBe('Tomorrow: nothing rostered');
  });

  it('puts the address on one line', () => {
    expect(addressLine({ addressLine: '1 Example St', suburb: 'Richmond', state: 'VIC', postcode: '3121' })).toBe('1 Example St, Richmond VIC 3121');
    expect(addressLine({ addressLine: null, suburb: null, state: null, postcode: null })).toBeNull();
  });

  it('shows the team now and later, never those who have left', () => {
    expect(memberLine(member({ teamRole: 'supervisor', areaName: 'Formwork', line: 'Until 20 Mar', distanceKm: 12.4 }))).toBe('Supervisor · Formwork · Until 20 Mar · 12 km from home');
    expect(memberLine(member())).toBe('No end date');
    const t = teamShown([member({ id: 'a' }), member({ id: 'b', state: 'upcoming' }), member({ id: 'c', state: 'ended' })]);
    expect(t.current.map(m => m.id)).toEqual(['a']);
    expect(t.upcoming.map(m => m.id)).toEqual(['b']);
  });

  it('says what is wrong with equipment, worst first', () => {
    expect(equipmentLine(equipment())).toEqual({ line: 'Excavator · Bay 2 · Until 20 Mar', problem: null });
    expect(equipmentLine(equipment({ checkState: 'overdue' })).problem).toBe('A date is overdue');
    expect(equipmentLine(equipment({ checkState: 'due_soon' })).problem).toBe('A date is due soon');
    expect(equipmentLine(equipment({ equipmentStatus: 'out_of_service', checkState: 'overdue' })).problem).toBe('Out of service');
  });

  it('words stock and the things to look at', () => {
    expect(stockLine({ itemId: 'i', name: 'Gloves', unit: 'pair', onHand: 12, reorderLevel: 20, low: true })).toBe('12 pair on hand (reorder at 20)');
    expect(stockLine({ itemId: 'i', name: 'Fuel', unit: 'L', onHand: 7.5, reorderLevel: null, low: false })).toBe('7.5 L on hand');
    const counts = { team: 3, equipment: 2, equipmentUnavailable: 1, equipmentChecks: 1, lowStock: 2 };
    expect(projectAlerts({ counts, week: { shifts: 10, unfilled: 1 } }, word, kit)).toEqual([
      '1 shift unfilled this week', '1 plant out of service', '1 plant with a date due or overdue', '2 items low on stock',
    ]);
    expect(projectAlerts({ counts: { ...counts, equipmentUnavailable: 0, equipmentChecks: 0, lowStock: 0 }, week: { shifts: 3, unfilled: 0 } }, word, kit)).toEqual([]);
  });
});
