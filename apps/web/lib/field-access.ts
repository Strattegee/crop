/**
 * Settings › Personal details (function 9180, David, 3 Nov 2026, answer 5): who can see and change each piece of a
 * person's details. The office always can; each field says what the person gets in the app. Keep the levels in step
 * with `ACCESS_LEVELS` in apps/api/src/workforce/field-access.ts. Pure: no data fetching.
 */
export type Access = 'hidden' | 'see' | 'approve' | 'change';
export type FieldAccessRow = {
  field: string; label: string; person: Access; isDefault: boolean; defaultPerson: Access; allowed: Access[]; note: string | null;
};

export const ACCESS_ORDER: Access[] = ['hidden', 'see', 'approve', 'change'];

/** The choices a field offers, in order, worded; CROP's default marked. */
export function accessChoices(row: FieldAccessRow, words: Record<Access, string>): { value: Access; label: string }[] {
  return ACCESS_ORDER.filter(a => row.allowed.includes(a))
    .map(a => ({ value: a, label: a === row.defaultPerson ? `${words[a]} (CROP’s default)` : words[a] }));
}

/** "Using CROP’s defaults" or "2 changed from CROP’s defaults". */
export function accessSummary(rows: FieldAccessRow[]): string {
  const changed = rows.filter(r => !r.isDefault).length;
  return changed === 0 ? 'Using CROP’s defaults' : `${changed} changed from CROP’s defaults`;
}

/** The form's choices as the API wants them: only fields on the list, only levels they allow. */
export function accessFromForm(rows: FieldAccessRow[], get: (field: string) => string | null): Record<string, Access> {
  const out: Record<string, Access> = {};
  for (const r of rows) {
    const v = get(r.field) as Access | null;
    if (v && r.allowed.includes(v)) out[r.field] = v;
  }
  return out;
}

/** Details the settings don't cover, and what happens to them (shown so the page answers "what about …?"). */
export const FIXED_DETAILS: { label: string; line: string }[] = [
  { label: 'Date of birth', line: 'Office only: it is used for the under-18 checks and never shown in the app.' },
  { label: 'Credentials', line: 'They see their own and can add new ones in the app; the office verifies each one. Earlier versions are kept.' },
  { label: 'Right to work', line: 'The office records the details; they can see the status and send proof in the app.' },
];
