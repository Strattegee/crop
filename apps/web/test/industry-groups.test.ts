import { describe, expect, it } from 'vitest';
import { industryGroups, needsHeadings } from '../lib/industry-groups';

const packs = [
  { id: 'healthcare', name: 'Healthcare and aged care', appliedAt: null },
  { id: 'hospitality', name: 'Hospitality', appliedAt: '2026-10-29' },
  { id: 'security', name: 'Security', appliedAt: '2026-10-30' },
];
const show = (gs: ReturnType<typeof industryGroups<{ name: string; industries?: string[] }>>) => gs.map(g => `${g.label}: ${g.items.map(i => i.name).join(', ')}`);

describe('grouping by industry (David, 31 Oct)', () => {
  it("puts each thing under the business's industry, shared ones together, its own and others last", () => {
    const list = [
      { name: 'RSA', industries: ['hospitality', 'security'] },
      { name: 'Barista', industries: ['hospitality'] },
      { name: 'Security licence', industries: ['security'] },
      { name: 'First aid', industries: ['healthcare', 'hospitality'] },
      { name: 'Our induction', industries: [] },
      { name: 'AHPRA', industries: ['healthcare'] },
      { name: 'Old type' },
    ];
    expect(show(industryGroups(list, packs))).toEqual([
      'Hospitality: Barista, First aid',
      'Security: Security licence',
      'Across your industries: RSA',
      'Added by you: Our induction, Old type',
      'Healthcare and aged care (not one of your industries): AHPRA',
    ]);
  });
  it('names each industry when the business has not picked any yet', () => {
    const none = packs.map(p => ({ ...p, appliedAt: null }));
    expect(show(industryGroups([{ name: 'Barista', industries: ['hospitality'] }, { name: 'RSA', industries: ['hospitality', 'security'] },
      { name: 'AHPRA', industries: ['healthcare'] }], none))).toEqual(['Common to several industries: RSA', 'Healthcare and aged care: AHPRA', 'Hospitality: Barista']);
  });
  it('leaves headings out when there is only one group', () => {
    const gs = industryGroups([{ name: 'Barista', industries: ['hospitality'] }], packs);
    expect(needsHeadings(gs)).toBe(false);
    expect(industryGroups([], packs)).toEqual([]);
  });
});
