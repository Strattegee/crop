import { describe, expect, it } from 'vitest';
import { accessChoices, accessFromForm, accessSummary, type FieldAccessRow } from '../lib/field-access';

const words = { hidden: 'Office only', see: 'They can see it', approve: 'They can change it; the office approves', change: 'They can change it' };
const row = (field: string, over: Partial<FieldAccessRow> = {}): FieldAccessRow => ({
  field, label: field, person: 'change', isDefault: true, defaultPerson: 'change', allowed: ['hidden', 'see', 'approve', 'change'], note: null, ...over,
});

describe('personal details settings (David, 3 Nov, answer 5)', () => {
  it('offers only the levels a field allows, marking CROP’s default', () => {
    const email = row('email', { person: 'see', defaultPerson: 'see', allowed: ['hidden', 'see', 'approve'] });
    expect(accessChoices(email, words)).toEqual([
      { value: 'hidden', label: 'Office only' },
      { value: 'see', label: 'They can see it (CROP’s default)' },
      { value: 'approve', label: 'They can change it; the office approves' },
    ]);
  });

  it('counts the fields changed from the defaults', () => {
    expect(accessSummary([row('mobile'), row('gender')])).toBe('Using CROP’s defaults');
    expect(accessSummary([row('mobile', { isDefault: false }), row('gender', { isDefault: false })])).toBe('2 changed from CROP’s defaults');
  });

  it('reads the form, dropping levels a field can’t have', () => {
    const rows = [row('mobile'), row('name', { allowed: ['see', 'approve'] })];
    const form: Record<string, string> = { mobile: 'approve', name: 'hidden', other: 'see' };
    expect(accessFromForm(rows, f => form[f] ?? null)).toEqual({ mobile: 'approve' });
  });
});
