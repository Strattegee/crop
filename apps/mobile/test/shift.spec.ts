import { describe, expect, it } from 'vitest';
import {
  actionsFor, assignable, canSetCovering, coveringChoices, coveringMessage, assignedMessage, assignQuestion, candidateMeta, candidateState, confirmLabel, mondayOf, offerable, offeredMessage,
  pendingOffers, phoneLinks, requestKind, sentences, shiftWhen, stageOf, type Candidate, type ShiftDetail,
} from '../src/shift';

const shift: ShiftDetail = {
  id: 's', facilityId: 'f', facilityName: 'Main St', areaName: 'Kitchen', role: 'Cook', status: 'open', equipmentOnly: false,
  localDate: '2026-11-02', localStart: '07:00', localEnd: '15:30', hours: 8,
  workerId: null, workerName: null, assignmentStatus: null, agencyName: null,
  offersPending: 0, pulledOutName: null, coveringName: null, cancelledReason: null, notes: null,
};
const person = (over: Partial<Candidate>): Candidate => ({
  workerId: 'w', name: 'Sam Lee', employmentType: 'casual', weekHours: 12, available: true, eligible: true, blocks: [], warnings: [], offer: null, ...over,
});

describe('a shift in manager mode', () => {
  it('names the stage as the roster does', () => {
    expect(stageOf(shift)).toEqual({ label: 'Nobody on it', tone: 'urgent' });
    expect(stageOf({ ...shift, pulledOutName: 'Jo Bloggs' }).label).toBe('Nobody on it (Jo Bloggs pulled out)');
    expect(stageOf({ ...shift, offersPending: 2 })).toEqual({ label: 'Offered to 2 people, nobody yet', tone: 'waiting' });
    const on = { ...shift, status: 'assigned', workerId: 'w', workerName: 'Sam Lee', assignmentStatus: 'assigned' as const };
    expect(stageOf(on).label).toBe('Sam Lee, waiting for them to confirm');
    expect(stageOf({ ...on, agencyName: 'Acme Staff' }).label).toBe('Sam Lee from Acme Staff, waiting for you to approve');
    expect(stageOf({ ...on, status: 'booked', assignmentStatus: 'confirmed' })).toEqual({ label: 'Booked: Sam Lee', tone: 'booked' });
    expect(stageOf({ ...shift, status: 'cancelled', cancelledReason: 'Client closed' }).label).toBe('Cancelled: Client closed');
    expect(stageOf({ ...shift, equipmentOnly: true }).label).toBe('No equipment on it yet');
  });

  it('says when it is and how long', () => {
    expect(shiftWhen(shift)).toBe('Mon 2 Nov 07:00–15:30 (8 h)');
    expect(shiftWhen({ ...shift, hours: 7.5 }, '2026-11-02')).toBe('Today 07:00–15:30 (7.5 h)');
  });

  it('describes each person who could work it', () => {
    expect(candidateMeta(person({}))).toBe('Casual · 12 h this week');
    expect(candidateMeta(person({ employmentType: null, weekHours: 0 }))).toBe('0 h this week');
    expect(candidateState(person({}))).toEqual({ label: 'Ready', tone: 'ready' });
    expect(candidateState(person({ warnings: [{ code: 'rest', message: 'Short rest.' }, { code: 'availability', message: 'Not available' }] })))
      .toEqual({ label: 'Short rest. Not available', tone: 'warning' });
    expect(candidateState(person({ eligible: false, blocks: [{ code: 'role', message: "Sam Lee doesn't have the role Cook" }] })).tone).toBe('blocked');
  });

  it('asks before putting someone on, with any warnings', () => {
    const word = { lower: 'shift' };
    expect(assignQuestion(person({}), word)).toEqual({ title: 'Put Sam Lee on this shift?' });
    expect(assignQuestion(person({ warnings: [{ code: 'rest', message: 'Short rest' }] }), word).message).toBe('Short rest.');
    expect(assignedMessage('Sam Lee', [])).toBe('Sam Lee is on it, waiting for them to confirm.');
    expect(assignedMessage('Sam Lee', [{ code: 'gender', message: 'Female requested.' }])).toBe('Sam Lee is on it, waiting for them to confirm. Note: Female requested.');
    expect(sentences(['a.', ' b ', ''])).toBe('a. b');
  });

  it('offers only to bank and casual staff who can work it and have no offer waiting', () => {
    const list = [
      person({ workerId: '1', employmentType: 'casual' }),
      person({ workerId: '2', employmentType: 'bank', offer: { id: 'o', status: 'pending' } }),
      person({ workerId: '3', employmentType: 'bank', offer: { id: 'o', status: 'declined' } }),
      person({ workerId: '4', employmentType: 'full_time' }),
      person({ workerId: '5', employmentType: 'bank', eligible: false }),
    ];
    expect(offerable(list).map(c => c.workerId)).toEqual(['1', '3']);
    expect(assignable(list).map(c => c.workerId)).toEqual(['1', '2', '3', '4']);
    expect(pendingOffers([{ id: 'a', workerId: '1', workerName: 'A', status: 'pending' }, { id: 'b', workerId: '2', workerName: 'B', status: 'expired' }]).map(o => o.id)).toEqual(['a']);
    expect(offeredMessage({ offered: 2, alreadyOffered: 1, messages: 4 }))
      .toBe('Offered to 2 people. 1 already had an offer waiting. They have been sent a message; the first to accept gets it.');
    expect(offeredMessage({ offered: 1, alreadyOffered: 0, messages: 0 })).toBe('Offered to 1 person. No messages were sent (no email or mobile on file).');
  });

  it('works out what can be done to the shift now', () => {
    expect(actionsFor(shift, false)).toEqual(['assign', 'offer', 'cancel']);
    expect(actionsFor(shift, true)).toEqual(['assign', 'cancel']);
    const on = { ...shift, status: 'assigned', workerId: 'w', workerName: 'Sam', assignmentStatus: 'assigned' as const };
    expect(actionsFor(on, false)).toEqual(['confirm', 'remove', 'pulled_out', 'cancel']);
    expect(actionsFor({ ...on, status: 'booked', assignmentStatus: 'confirmed' }, false)).toEqual(['remove', 'pulled_out', 'cancel']);
    expect(actionsFor({ ...shift, equipmentOnly: true }, false)).toEqual(['cancel']);
    expect(actionsFor({ ...shift, status: 'cancelled' }, false)).toEqual([]);
    expect(requestKind('pulled_out')).toBe('pulled_out');
    expect(requestKind('offer')).toBeNull();
    expect(confirmLabel({ agencyName: null, workerName: 'Sam' })).toBe('Mark as confirmed');
    expect(confirmLabel({ agencyName: 'Acme', workerName: 'Sam' })).toBe('Approve Sam');
  });

  it('finds the Monday of the week and phone links', () => {
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(mondayOf('2026-11-04')).toBe('2026-11-02');
    expect(phoneLinks('0412 345 678')).toEqual({ call: 'tel:0412345678', text: 'sms:0412345678' });
    expect(phoneLinks('+61 (4) 1234-5678')).toEqual({ call: 'tel:+61412345678', text: 'sms:+61412345678' });
    expect(phoneLinks('')).toBeNull();
    expect(phoneLinks(null)).toBeNull();
  });
});

describe('the covering line from the phone', () => {
  const people = [{ id: 'a', name: 'Ann Bell' }, { id: 'b', name: 'Bo Chen' }, { id: 'c', name: 'Cy Dunn' }, { id: 'd', name: 'Di Ede' }];
  const leave = [
    { workerId: 'c', status: 'requested' as const, startsOn: '2026-11-01', endsOn: '2026-11-03' },
    { workerId: 'd', status: 'approved' as const, startsOn: '2026-11-02', endsOn: '2026-11-02' },
    { workerId: 'a', status: 'approved' as const, startsOn: '2026-11-05', endsOn: '2026-11-06' },
  ];

  it('puts people away that day first, never the kind of leave, and leaves out whoever works it', () => {
    const list = coveringChoices(people, leave, '2026-11-02', { id: null, name: null }, 'b');
    expect(list.map(c => c.label)).toEqual(['Di Ede · on leave', 'Cy Dunn · leave requested', 'Ann Bell']);
    expect(list.map(c => c.away)).toEqual([true, true, false]);
  });

  it('keeps whoever it covers now even if they are no longer on the roster', () => {
    const list = coveringChoices(people, [], '2026-11-02', { id: 'z', name: 'Al Zed' }, null);
    expect(list.some(c => c.id === 'z' && c.label === 'Al Zed')).toBe(true);
    expect(coveringChoices(people, [], '2026-11-02', { id: 'a', name: 'Ann Bell' }, null).filter(c => c.id === 'a')).toHaveLength(1);
  });

  it('can only be changed on live people shifts while changes are allowed', () => {
    expect(canSetCovering(shift, false)).toBe(true);
    expect(canSetCovering(shift, true)).toBe(false);
    expect(canSetCovering({ ...shift, status: 'cancelled' }, false)).toBe(false);
    expect(canSetCovering({ ...shift, equipmentOnly: true }, false)).toBe(false);
  });

  it('says what the card will show', () => {
    expect(coveringMessage('Di Ede')).toBe('Shown as "Covering Di Ede". The reason they\'re away is never shown.');
    expect(coveringMessage(null)).toBe('It no longer says who it covers.');
  });
});
