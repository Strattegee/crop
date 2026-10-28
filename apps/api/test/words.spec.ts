import { describe, expect, it } from 'vitest';
import { bookedMessage, filledMessage, offerMessage } from '../src/roster/bank-fill.js';
import { requestArrivedEmail, requestDecidedEmail, requestProblem, requestSummary } from '../src/roster/change-requests.js';
import { rosterMessage } from '../src/roster/publishing.js';
import { DEFAULT_WORDS, makeWords, T } from '../src/terms/words.js';

describe('the business\'s words in messages', () => {
  const jobs = makeWords([{ code: T.shift, singular: 'Job', plural: 'Jobs' }, { code: T.roster, singular: 'Schedule', plural: 'Schedules' }]);
  const s = { role: 'Chef', localDate: '2026-11-02', localStart: '07:00', localEnd: '15:30', facilityName: 'Harbour Kitchen', areaName: null };

  it('falls back to CROP\'s words and picks a or an', () => {
    expect(DEFAULT_WORDS.one(T.shift)).toBe('Shift');
    expect(DEFAULT_WORDS.count(1, T.shift)).toBe('1 shift');
    expect(DEFAULT_WORDS.count(2, T.shift)).toBe('2 shifts');
    expect(jobs.a(T.shift)).toBe('a job');
    expect(makeWords([{ code: T.shift, singular: 'Assignment', plural: 'Assignments' }]).a(T.shift)).toBe('an assignment');
    // A blank plural uses the singular; blank words fall back.
    expect(makeWords([{ code: T.shift, singular: 'Booking', plural: '' }]).many(T.shift)).toBe('Booking');
    expect(makeWords([{ code: T.shift, singular: ' ', plural: ' ' }]).one(T.shift)).toBe('Shift');
  });

  it('words offers, bookings and filled shifts with them', () => {
    const o = offerMessage('Ana', 'Demo Cafe', s, null, null, jobs);
    expect(o.subject).toBe('Job available: Mon 2 Nov 07:00–15:30');
    expect(o.sms).toBe('Hi Ana, Demo Cafe has a job for you: Mon 2 Nov, 07:00–15:30, Chef at Harbour Kitchen. Contact Demo Cafe if you\'d like it; the first to accept gets it.');
    expect(o.email).toContain('Demo Cafe has a job available:');
    expect(offerMessage('Ana', 'Demo Cafe', s, null, 'https://crop.test/offer/x', jobs).sms).toContain('has a job for you');
    expect(bookedMessage('Ana', 'Demo Cafe', s, jobs).email).toContain("You're booked for this job:");
    const f = filledMessage('Ana', 'Demo Cafe', s, jobs);
    expect(f.subject).toBe('Job filled: Mon 2 Nov 07:00–15:30');
    expect(f.email).toContain('The job we offered you has now been filled');
    // Without words, the messages read as before.
    expect(offerMessage('Ana', 'Demo Cafe', s, null).subject).toBe('Shift available: Mon 2 Nov 07:00–15:30');
  });

  it('words the published roster message with them', () => {
    const shifts = [{ localDate: '2026-11-09', localStart: '07:00', localEnd: '15:30', role: 'Chef', areaName: null, confirmed: true }];
    const m = rosterMessage({ first: 'Ana', business: 'Demo Cafe', site: 'Harbour Kitchen', weekStart: '2026-11-09', updated: false, shifts }, jobs);
    expect(m.subject).toMatch(/^Your jobs at Harbour Kitchen for the week of /);
    expect(m.email).toContain('Demo Cafe has published the schedule for Harbour Kitchen');
    expect(m.email).toContain('Your jobs:\n- ');
    expect(m.sms).toMatch(/^Demo Cafe: your jobs at Harbour Kitchen/);
    const gone = rosterMessage({ first: 'Ana', business: 'Demo Cafe', site: 'Harbour Kitchen', weekStart: '2026-11-09', updated: true, shifts: [] }, jobs);
    expect(gone.email).toContain('You no longer have any jobs at Harbour Kitchen that week.');
    expect(gone.email).toContain('has changed the schedule for');
  });

  it('words change requests and their emails with them', () => {
    expect(requestSummary({ kind: 'assign', workerName: 'Ana Example', reason: null }, jobs)).toBe('Put Ana Example on the job');
    expect(requestSummary({ kind: 'cancel', workerName: null, reason: 'Quiet day' }, jobs)).toBe('Cancel the job: Quiet day');
    expect(requestProblem('remove', { status: 'open', equipmentOnly: false, hasPerson: false }, jobs)).toBe('Nobody is on this job');
    expect(requestProblem('assign', { status: 'cancelled', equipmentOnly: false, hasPerson: false }, jobs)).toBe('This job is cancelled');
    const r = {
      summary: 'Put Ana Example on the job', reason: null, kind: 'assign' as const, requestedByName: 'Sam Allocator',
      facilityName: 'Harbour Kitchen', areaName: null, role: 'Chef', localDate: '2031-03-04', localStart: '07:00', localEnd: '15:00',
      weekStart: '2031-03-03', facilityId: 'f1', shiftId: 's1',
    };
    const a = requestArrivedEmail(r, '', jobs);
    expect(a.body).toContain('asked for a change to the published schedule at Harbour Kitchen.');
    expect(a.body).toContain('Job: Tuesday 4 March, 07:00–15:00, Chef, Harbour Kitchen');
    expect(a.body).toContain('open the job on the schedule in CROP');
    const d = requestDecidedEmail(r, 'declined', 'Olive Owner', null, 'https://crop.test', jobs);
    expect(d.body).toContain('Your request for a change to the schedule at Harbour Kitchen has been declined.');
    expect(d.body).toContain('so the job stays as it was.');
    expect(d.body).toContain('See the job: https://crop.test/roster?');
  });
});
