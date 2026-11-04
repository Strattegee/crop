import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DetailChange } from '../lib/detail-changes';

vi.mock('../app/(office)/workers/[id]/detail-change-actions', () => ({ approveDetailChange: async () => {}, declineDetailChange: async () => {} }));
const { DetailChangesCard } = await import('../app/(office)/workers/[id]/detail-changes-card');

const c: DetailChange = {
  id: 'c1', workerId: 'w1', workerName: 'Ana Example', field: 'mobile', action: null, label: 'Mobile', what: 'Change mobile',
  askedLine: '+61498765432', wasLine: '+61412345678', nowLine: null, status: 'pending', createdAt: '2026-11-04T00:00:00Z',
  decidedAt: null, decidedByName: null, decidedNote: null, canDecide: true,
};

describe('detail changes card (David, 3 Nov, answer 5)', () => {
  it('shows nothing when nothing is waiting', () => {
    expect(renderToStaticMarkup(<DetailChangesCard changes={[]} back="/dashboard" country="AU" withNames />)).toBe('');
  });

  it('lists waiting changes with names and Approve for owners and admins', () => {
    const html = renderToStaticMarkup(<DetailChangesCard changes={[c]} back="/dashboard" country="AU" withNames />);
    expect(html).toContain('Detail changes to approve');
    expect(html).toContain('Ana Example');
    expect(html).toContain('From 0412 345 678 to 0498 765 432');
    expect(html).toContain('Approve');
    expect(html).toContain('value="/dashboard"');
  });

  it('on the person’s page shows decided ones and who decided, and no buttons for others', () => {
    const html = renderToStaticMarkup(<DetailChangesCard changes={[{ ...c, canDecide: false }, { ...c, id: 'c2', status: 'declined', decidedByName: 'Sam Admin' }]}
      back="/workers/w1?tab=details" country="AU" withNames={false} />);
    expect(html).toContain('Changes asked for in the app');
    expect(html).not.toContain('Ana Example');
    expect(html).toContain('An owner or admin approves changes.');
    expect(html).toContain('Not approved by Sam Admin');
  });
});
