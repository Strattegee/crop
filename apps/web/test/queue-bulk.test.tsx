import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../app/(office)/allocations/actions', () => ({ offerFromQueue: async () => {}, releaseMany: async () => {} }));
vi.mock('../app/(office)/allocations/queue-live', () => ({ QueueLive: () => null }));
vi.mock('../app/(office)/roster/actions', () => ({
  assign: async () => {}, clientConfirmed: async () => {}, confirm: async () => {}, offer: async () => {}, recordReply: async () => {},
  unassign: async () => {}, undoClientConfirmed: async () => {},
}));
vi.mock('../app/(office)/roster/agency-fill-section', () => ({ AgencyFillSection: () => null }));
const { QueueScreen } = await import('../app/(office)/allocations/queue');
const { makeWords } = await import('../lib/term-words');
const { parseQueueParams } = await import('../lib/allocation-queue');

const NOW = Date.parse('2026-11-02T08:00:00Z');
const row = (id: string, stage: string, band: string) => ({
  id, facilityId: 'f', facilityName: 'Bayside', region: 'NSW', areaName: null, role: 'Nurse', status: 'open', startsAt: '2026-11-03T20:00:00Z',
  localDate: '2026-11-04', localStart: '07:00', localEnd: '15:00', dayLabel: 'Wed', hours: 8, genderRequested: null, notes: null,
  clientId: 'c', clientName: 'Bayside Health', clientRank: 2, clientConfirms: false, orderId: 'o', clientReference: null, channelWords: null,
  requestedByName: null, orderNotes: null, workerId: null, workerName: null, clientConfirmedAt: null, offersTotal: 0, offersPending: 0,
  offersDeclined: 0, pulledOutName: null, withAgencies: false, waitingSince: null, stage, band, progress: 'Not offered yet', presence: [], youAreOn: false,
});

describe('releasing several from the queue', () => {
  it('offers "Release N new" on a band with two or more new shifts, listing only those', () => {
    const shifts = [row('a1', 'new', 'tomorrow'), row('a2', 'released', 'tomorrow'), row('a3', 'new', 'tomorrow'), row('b1', 'new', 'later')];
    const q = { counts: {} as never, regions: [], bands: {} as never, total: shifts.length, shifts: shifts as never };
    const html = renderToStaticMarkup(<QueueScreen tw={makeWords([])} p={parseQueueParams({})} q={q} clients={[]} panel={null} now={NOW} when={s => s} />);
    expect(html.match(/Release 2 new/g)).toHaveLength(1); // tomorrow only; "later" has just one new shift
    expect(html).toContain('name="shiftId" value="a1"');
    expect(html).toContain('name="shiftId" value="a3"');
    expect(html).not.toContain('name="shiftId" value="a2"');
    expect(html).not.toContain('name="shiftId" value="b1"');
    expect(html).toContain('Release 2 shifts to the bank');
    expect(html).toContain('data-hold');
  });
});
