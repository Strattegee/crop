import { describe, expect, it } from 'vitest';
import {
  credentialLine, filterLabel, hoursLine, issueLine, issuesInOrder, matchesPerson, nextExpiryLine, peopleShown, personLine, personName,
  type PersonRow,
} from '../src/people';

function person(over: Partial<PersonRow> = {}): PersonRow {
  return {
    id: 'w1', firstName: 'Samantha', lastName: 'Example', preferredName: null, status: 'active', roles: ['Carer'], compliance: 'compliant', issueCount: 0,
    card: { nextExpiry: null, held: [], toCheck: 0, employmentType: 'part_time', contractedHours: 24, weekHours: 18, nextShift: null }, ...over,
  };
}

describe('people in manager mode', () => {
  it('names people by their preferred name', () => {
    expect(personName(person())).toBe('Samantha Example');
    expect(personName(person({ preferredName: 'Sam' }))).toBe('Sam Example');
  });

  it('says roles, employment and a status that isn’t simply active', () => {
    expect(personLine(person({ roles: ['Carer', 'Cook'] }))).toBe('Carer, Cook · Part-time');
    expect(personLine(person({ roles: [], status: 'inactive', card: null }))).toBe('Inactive');
  });

  it('gives hours against the contract when there is one', () => {
    expect(hoursLine(person().card)).toBe('18 / 24 h this week');
    expect(hoursLine({ nextExpiry: null, held: [], toCheck: 0, contractedHours: null, weekHours: 7.5 })).toBe('7.5 h this week');
    expect(hoursLine(null)).toBeNull();
  });

  it('words the next expiry like the web card', () => {
    expect(nextExpiryLine({ name: 'First aid', date: '2026-11-06' }, '2026-11-06')).toEqual({ text: 'First aid expires today', soon: true });
    expect(nextExpiryLine({ name: 'First aid', date: '2026-11-07' }, '2026-11-06')).toEqual({ text: 'First aid expires tomorrow', soon: true });
    expect(nextExpiryLine({ name: 'First aid', date: '2026-12-20' }, '2026-11-06')).toEqual({ text: 'First aid expires in 44 days', soon: false });
    expect(nextExpiryLine({ name: 'First aid', date: '2027-03-01' }, '2026-11-06')!.text).toBe('First aid expires 1 Mar 2027');
    expect(nextExpiryLine(null, '2026-11-06')).toBeNull();
  });

  it('words issues and puts must-haves first, expiring last', () => {
    const list = issuesInOrder([
      { credentialTypeId: 'a', typeName: 'Food safety', severity: 'warning', problem: 'missing' },
      { credentialTypeId: 'b', typeName: 'First aid', severity: 'hard', problem: 'expiring' },
      { credentialTypeId: 'c', typeName: 'Right to work', severity: 'hard', problem: 'missing' },
    ]);
    expect(list.map(i => i.credentialTypeId)).toEqual(['c', 'b', 'a']);
    expect(issueLine({ credentialTypeId: 'd', typeName: 'RSA', severity: 'hard', problem: 'expired', forDuty: 'Serving alcohol' }))
      .toBe('RSA: expired (needed for Serving alcohol)');
  });

  it('words credentials with their check and dates', () => {
    expect(credentialLine({ id: 'c', typeName: 'First aid', expiryDate: '2026-12-01', verification: 'verified', status: 'valid' })).toBe('Checked · Expires 1 Dec 2026');
    expect(credentialLine({ id: 'c', typeName: 'First aid', expiryDate: '2026-11-03', verification: 'verified', status: 'expired' })).toBe('Checked · Expired 3 Nov 2026');
    expect(credentialLine({ id: 'c', typeName: 'Police check', expiryDate: null, verification: 'unverified', status: 'valid' })).toBe('Not checked yet · No expiry');
  });

  it('searches names and roles, every word', () => {
    expect(matchesPerson(person({ preferredName: 'Sam' }), 'sam carer')).toBe(true);
    expect(matchesPerson(person(), 'cook')).toBe(false);
    expect(matchesPerson(person(), '  ')).toBe(true);
  });

  it('filters and puts people not ready to work first, keeping the API’s order otherwise', () => {
    const list = [
      person({ id: 'a', lastName: 'Able' }),
      person({ id: 'b', lastName: 'Baker', compliance: 'expiring' }),
      person({ id: 'c', lastName: 'Cole', compliance: 'non_compliant' }),
      person({ id: 'd', lastName: 'Dunn' }),
    ];
    expect(peopleShown(list, 'all', '').map(p => p.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(peopleShown(list, 'not_ready', '').map(p => p.id)).toEqual(['c']);
    expect(peopleShown(list, 'expiring', '').map(p => p.id)).toEqual(['b']);
    expect(peopleShown(list, 'all', 'dunn').map(p => p.id)).toEqual(['d']);
    expect(filterLabel('all', list)).toBe('All 4');
    expect(filterLabel('not_ready', list)).toBe('Not ready 1');
    expect(filterLabel('expiring', list)).toBe('Expiring 1');
  });
});
