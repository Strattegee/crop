import { describe, expect, it } from 'vitest';
import { contactLine, contactSavedNote, contactsFor, RANK_CHOICES, STAGES, allocationsMenu, canRecordClientYes, askedLine, byDay, clientConfirmLine, findStaffHref, orderPlaces, parsePlace, rankChip, stageLabel, sentLine } from '../lib/client-orders';

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
    expect(allocationsMenu({ agencyLinks: 0, open: 0, hasClients: false, customerPage: true, customerRequests: 0 })).toEqual({ show: true, count: 0 });
    expect(allocationsMenu({ agencyLinks: 0, open: 0, hasClients: true, clientShiftsOpen: 5, customerRequests: 2 })).toEqual({ show: true, count: 7 });
  });

  it('words the client-to-confirm stage and the client’s rank (migration 0069)', () => {
    expect(STAGES).toEqual(['open', 'offered', 'assigned', 'worker_to_confirm', 'client_to_confirm', 'booked']);
    expect(stageLabel('worker_to_confirm')).toBe('Worker to confirm');
    expect(stageLabel('worker_to_confirm', 'Customer', 'Employee')).toBe('Employee to confirm');
    expect(canRecordClientYes({ stage: 'assigned', clientConfirms: true })).toBe(true);
    expect(canRecordClientYes({ stage: 'assigned', clientConfirms: false })).toBe(false);
    expect(canRecordClientYes({ stage: 'client_to_confirm' })).toBe(true);
    expect(canRecordClientYes({ stage: 'worker_to_confirm', clientConfirms: true })).toBe(false);
    expect(canRecordClientYes({ stage: 'open', clientConfirms: true })).toBe(false);
    expect(stageLabel('client_to_confirm')).toBe('Client to confirm');
    expect(stageLabel('client_to_confirm', 'Customer')).toBe('Customer to confirm');
    expect(stageLabel('booked', 'Customer')).toBe('Booked');
    expect(rankChip(1)).toBe('Rank 1');
    expect(rankChip(null)).toBeNull();
    expect(rankChip(9)).toBeNull();
    expect(RANK_CHOICES.map(r => r.value)).toEqual(['', '1', '2', '3', '4', '5', '6', '7']);
    expect(RANK_CHOICES[1].label).toBe('1 (most loyal)');
    expect(RANK_CHOICES[7].label).toBe('7 (fill-in, last option)');
  });

  it('says on the shift panel whether the client still has to confirm', () => {
    const when = (iso: string) => `at ${iso}`;
    const booked = { status: 'booked', workerName: 'Sarah Example', clientConfirms: true, clientConfirmedAt: null };
    expect(clientConfirmLine(booked, 'client', when)).toEqual({ waiting: true,
      text: 'Not final yet: waiting for the client to confirm Sarah Example. Record it when they say yes; if they say no, remove the person.' });
    expect(clientConfirmLine({ ...booked, clientConfirmedAt: 'T', clientConfirmedBy: 'Alex Office' }, 'customer', when))
      .toEqual({ waiting: false, text: 'The customer confirmed, recorded by Alex Office at T.' });
    expect(clientConfirmLine({ ...booked, clientConfirms: false }, 'client', when)).toBeNull();
    expect(clientConfirmLine({ ...booked, status: 'open', workerName: null }, 'client', when)).toBeNull();
    // Either side can say yes first (David, 2 Nov).
    expect(clientConfirmLine({ ...booked, status: 'assigned' }, 'client', when)).toEqual({ waiting: true,
      text: 'The client confirms each booking. Record their yes when they\'re happy with Sarah Example; it\'s final once both have confirmed.' });
    expect(clientConfirmLine({ ...booked, status: 'assigned', clientConfirmedAt: 'T', clientConfirmedBy: 'Alex Office' }, 'client', when)).toEqual({ waiting: false,
      text: 'The client confirmed Sarah Example, recorded by Alex Office at T. Waiting for Sarah Example to confirm; it\'s final when they do.' });
  });
});

describe('sentLine', () => {
  it('counts booked and change emails sent to the client', () => {
    expect(sentLine(1, 0)).toBe('1 booked email sent');
    expect(sentLine(2, 1)).toBe('2 booked emails sent · 1 change email sent');
    expect(sentLine(0, 3)).toBe('3 change emails sent');
  });

  it('lists the chosen client’s saved contacts and words them (migration 0072)', () => {
    const contacts = [
      { id: 'k2', clientId: 'c1', name: 'Pat Ward', position: null, email: 'pat@bayside.example', phone: null },
      { id: 'k1', clientId: 'c1', name: 'Jo Bloggs', position: 'Nurse unit manager', email: null, phone: '0400 111 222' },
      { id: 'k3', clientId: 'c1', name: 'Old Contact', position: null, email: null, phone: null, active: false },
      { id: 'k4', clientId: 'c2', name: 'Lee Example', position: null, email: null, phone: null },
    ];
    expect(contactsFor(contacts, 'c1|s1|a1').map(c => c.id)).toEqual(['k1', 'k2']);
    expect(contactsFor(contacts, 'c2|s2|').map(c => c.id)).toEqual(['k4']);
    expect(contactsFor(contacts, '')).toEqual([]);
    expect(contactLine(contacts[1])).toBe('Jo Bloggs (Nurse unit manager) · 0400 111 222');
    expect(contactLine(contacts[0])).toBe('Pat Ward · pat@bayside.example');
    expect(contactLine(contacts[1], false)).toBe('Jo Bloggs (Nurse unit manager)');
    expect(contactSavedNote(true, 'Lee', 'client')).toBe(' Lee is saved as a contact for this client.');
    expect(contactSavedNote(false, 'Lee', 'client')).toBe('');
  });
});
