/**
 * Letters on roster cards (David, 3 Nov: each employer can customise them; Settings › Shift types, migration 0079).
 * Keep the defaults in step with `DEFAULT_MARKER_LETTERS` in apps/api/src/roster/markers.ts.
 */
export const MARKER_KINDS = ['duty', 'vehicle', 'equipment', 'items', 'template', 'request'] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];
export type MarkerLetters = Record<MarkerKind, string>;
export const DEFAULT_MARKER_LETTERS: MarkerLetters = { duty: 'D', vehicle: 'V', equipment: 'E', items: 'I', template: 'T', request: 'R' };

/** The letters to show: the business's, CROP's default for anything missing. */
export const lettersOf = (s?: Partial<MarkerLetters> | null): MarkerLetters => ({ ...DEFAULT_MARKER_LETTERS, ...(s ?? {}) });

/** What each letter stands for, for Settings and the roster's key (words from the business where they're renamable). */
export function markerMeaning(kind: MarkerKind, w: { equipment: string; items: string }): string {
  return { duty: 'Duties', vehicle: 'Vehicle', equipment: w.equipment, items: w.items, template: 'Template: who usually works it', request: 'Request from the worker' }[kind];
}
