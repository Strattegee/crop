import { describe, expect, it } from 'vitest';
import { allocationsMenu, askedLine, byDay, findStaffHref, orderPlaces, parsePlace } from '../lib/client-orders';

describe('client orders on Allocations (David, 2 Nov)', () => {
  it('offers client sites and their areas as one choice, grouped by client', () => {
    const groups = orderPlaces([
      { id: 's2', name: 'Hillview House', clientId: 'c2', clientName: 'Hillview Care', active: true },
      { id: 's1', name: 'Bayside Campus', clientId: 'c1', clientName: 'Bayside Health', active: true,
        areas: [{ id: 'a2', name: 'Ward 5', active: true }, { id: 'a1', name: 'Ward 4', active: true }, { id: 'a3', name: 'Old wing', active: false }] },
      { id: 's3', name: 'Head Office', clientId: null, clientName: null, active: true },
      { id: 's4', name: 'Closed House', clientId: 'c2', clientName: 'Hillview Care', active: false },
    ]);
    expect(groups.map(g => g.clientName)).toEqual(['Bayside Health', 'Hillview Care']);
    expect(groups[0].options).toEqual([
      { value: 'c1|s1|', label: 'Bayside Health · Bayside Campus' },
      { value: 'c1|s1|a1', label: 'Bayside Health · Bayside Campus · Ward 4' },
      { value: 'c1|s1|a2', label: 'Bayside Health · Bayside Campus · Ward 5' },
    ]);
    expect(groups[1].options.map(o => o.value)).toEqual(['c2|s2|']);
    expect(parsePlace('c1|s1|')).toEqual({ clientId: 'c1', facilityId: 's1' });
    expect(parsePlace('c1|s1|a1')).toEqual({ clientId: 'c1', facilityId: 's1', areaId: 'a1' });
    expect(parsePlace('')).toBeNull();
    expect(parsePlace(undefined)).toBeNull();
  });

  it('links to the shift on the roster, in its week', () => {
    expect(findStaffHref({ id: 'sh', facilityId: 's1', localDate: '2026-11-12' })).toBe('/roster?week=2026-11-09&site=s1&shift=sh#shift-panel');
  });

  it('groups shifts by day and words who asked', () => {
    const g = byDay([{ localDate: '2026-11-10', n: 1 }, { localDate: '2026-11-10', n: 2 }, { localDate: '2026-11-11', n: 3 }]);
    expect(g.map(x => [x.label, x.shifts.length])).toEqual([['Tuesday 10 November', 2], ['Wednesday 11 November', 1]]);
    expect(askedLine({ requestedByName: 'Pat Ward', orderChannel: 'email', clientReference: 'PO-77' })).toBe('Pat Ward · Email · ref PO-77');
    expect(askedLine({ requestedByName: null, orderChannel: null, clientReference: null })).toBe('');
  });

  it('shows Allocations in the menu for agency links or clients, counting what is still to fill', () => {
    expect(allocationsMenu(null)).toEqual({ show: false, count: 0 });
    expect(allocationsMenu({ agencyLinks: 0, open: 0, hasClients: false, clientShiftsOpen: 0 })).toEqual({ show: false, count: 0 });
    expect(allocationsMenu({ agencyLinks: 0, open: 0, hasClients: true, clientShiftsOpen: 5 })).toEqual({ show: true, count: 5 });
    expect(allocationsMenu({ agencyLinks: 1, open: 2, hasClients: true, clientShiftsOpen: 5 })).toEqual({ show: true, count: 7 });
    expect(allocationsMenu({ agencyLinks: 1, open: 2 })).toEqual({ show: true, count: 2 });
  });
});
