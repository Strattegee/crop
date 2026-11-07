import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../app/(office)/recruitment/list-actions', () => ({
  bulkAsk: async () => {}, bulkMove: async () => {}, bulkNotProceeding: async () => {}, bulkOnboard: async () => {},
}));
const { RecruitList } = await import('../app/(office)/recruitment/list-view');
const { makeWords } = await import('../lib/term-words');
const { parseRecruitParams } = await import('../lib/recruitment-list');

const row = (id: string, over: object = {}) => ({
  id, firstName: 'Ana', lastName: 'Example', preferredName: null, email: 'ana@example.com', phone: null, roles: ['Carer'], stage: 'applied',
  appliedAt: '2026-11-04T01:00:00Z', movedAt: '2026-11-04T01:00:00Z', days: 1, source: 'online' as const, workTypes: ['casual'],
  suburb: 'Geelong', region: 'VIC', postcode: '3220', docs: { done: 1, total: 3, toCheck: 1, missing: 1 }, needsAction: true, progress: null, ...over,
});

describe('recruitment list view', () => {
  it('renders a row per person with every column filter in the heading', () => {
    const data = {
      rows: [row('a'), row('b', { stage: 'onboarding', source: 'office', progress: { done: 2, total: 4, ready: false }, needsAction: false })],
      total: 120, more: 118, counts: { applied: 80, screening: 10, interview: 5, offer: 5, onboarding: 20, started: 3, not_proceeding: 7 },
      states: [{ value: 'VIC', count: 90 }], offices: [{ id: 'o1', name: 'Geelong office' }], km: 25, today: '2026-11-05',
    };
    const html = renderToStaticMarkup(
      <RecruitList data={data} p={parseRecruitParams({ role: 'Carer' })} tw={makeWords([])} zone="Australia/Melbourne"
        roleGroups={[{ key: 'own', label: 'Added by you', items: [{ name: 'Carer' }, { name: 'Nurse' }] }]} sites={[{ id: 's1', name: 'Bayside House' }]} canOnboard />,
    );
    expect(html).toContain('New applications <b>80</b>');
    expect(html).toContain('In progress <b>120</b>');
    for (const name of ['q', 'stage', 'role', 'work', 'state', 'place', 'office', 'near', 'km', 'docs', 'waiting', 'source']) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('Showing 2 of 120 people');
    expect(html).toContain('Show 100 more');
    expect(html).toContain('Clear filters');
    expect(html).toContain('href="/workers/a"');
    expect(html).toContain('1 of 3 · 1 to check');
    expect(html).toContain('2 of 4 steps');
    expect(html).toContain('Applied online');
    expect(html).toContain('Needs action');
    expect(html).toContain('Geelong VIC 3220');
    expect(html.match(/name="pick"/g)).toHaveLength(2);
    // The shared heading parts (7 Nov): one filter form, summaries in the recruitment list's words.
    expect(html).toContain('id="rl-filters"');
    expect(html).toContain('>Carer</summary>');
    expect(html).toContain('Any position</summary>');
    expect(html).toContain('Anywhere</summary>');
    expect(html).toContain('<b class="rl-group">State</b>');
    expect(html).toContain('aria-label="Region: Anywhere"');
  });
});
