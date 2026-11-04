/**
 * Settings › Personal details (function 9180, David, 3 Nov 2026, answer 5): who can see and change each piece of a
 * person's details. The office always can; each field says what the person gets in the app. Keep the levels in step
 * with `ACCESS_LEVELS` in apps/api/src/workforce/field-access.ts. Pure: no data fetching.
 */
export type Access = 'hidden' | 'see' | 'approve' | 'change';
export type FieldAccessRow = {
  field: string; group?: 'details' | 'documents'; label: string; person: Access; isDefault: boolean; defaultPerson: Access; allowed: Access[]; note: string | null;
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

/** The settings split into personal details and documents (migration 0088), each in the API's order. */
export function accessGroups(rows: FieldAccessRow[]): { details: FieldAccessRow[]; documents: FieldAccessRow[] } {
  return { details: rows.filter(r => r.group !== 'documents'), documents: rows.filter(r => r.group === 'documents') };
}

/** Details the settings don't cover, and what happens to them (shown so the page answers "what about …?"). */
export const FIXED_DETAILS: { label: string; line: string }[] = [
  { label: 'Date of birth', line: 'Office only: it is used for the under-18 checks and never shown in the app.' },
  { label: 'Checking documents', line: 'Only the office checks a document, so one sent from the app counts once an owner or administrator has checked it. Earlier versions are kept.' },
  { label: 'Upload links', line: 'A link the office sends asking for documents works whatever is set here: the office chose to ask.' },
];
