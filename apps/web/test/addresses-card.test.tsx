import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../app/(office)/workers/[id]/address-actions', () => ({
  addAddress: async () => {}, correctAddress: async () => {}, makeAddressCurrent: async () => {}, removeAddress: async () => {},
}));
const { AddressesCard } = await import('../app/(office)/workers/[id]/addresses-card');

const when = (iso: string) => iso.slice(0, 10);
const base = { line2: null, suburb: 'Richmond', region: 'VIC', postcode: '3121', country: 'AU', createdAt: '2026-11-01T00:00:00Z',
  replacedAt: null, removedAt: null, removedReason: null, replacesId: null };
const home = { ...base, id: 'a1', label: 'Home', line1: '12 Example Street', current: true, line: '12 Example Street, Richmond VIC 3121' };
const old = { ...base, id: 'a0', label: 'Home', line1: '21 Example Street', current: false, line: '21 Example Street, Richmond VIC 3121',
  replacedAt: '2026-11-02T00:00:00Z', ended: 'corrected' as const };
const parents = { ...base, id: 'a2', label: 'Parents', line1: '4 Sample Road', current: false, line: '4 Sample Road, Richmond VIC 3121' };

describe('addresses card (David, 3 Nov, answer 5)', () => {
  it('shows the current address, the others with Make current, and earlier versions', () => {
    const html = renderToStaticMarkup(<AddressesCard workerId="w1" a={{ current: home, others: [parents], earlier: [old] }} homeCountry="AU" when={when} />);
    expect(html).toContain('Home: 12 Example Street, Richmond VIC 3121');
    expect(html).toContain('Parents: 4 Sample Road');
    expect(html.match(/Make current/g)).toHaveLength(1);
    expect(html).toContain('Earlier versions (1)');
    expect(html).toContain('Corrected 2026-11-02');
    expect(html).toContain('Make it the current address');
  });

  it('opens the add form when there is nothing yet, without the current tick box', () => {
    const html = renderToStaticMarkup(<AddressesCard workerId="w1" a={{ current: null, others: [], earlier: [] }} homeCountry="NZ" when={when} />);
    expect(html).toContain('No address recorded yet.');
    expect(html).toContain('<details style="margin-top:12px" open="">');
    expect(html).not.toContain('Make it the current address');
    expect(html).toContain('<option value="NZ" selected="">New Zealand</option>');
  });
});
