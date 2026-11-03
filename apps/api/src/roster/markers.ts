/**
 * Letters on roster cards (David, 3 Nov: each employer can customise them; migration 0079 `tenant_settings.marker_letters`).
 * The letter column shows the shift letter, F/M for gender, then these. Pure rules, shared with the web's defaults.
 */
export const MARKER_KINDS = ['duty', 'vehicle', 'equipment', 'items', 'template', 'request'] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];
export type MarkerLetters = Record<MarkerKind, string>;
export const DEFAULT_MARKER_LETTERS: MarkerLetters = { duty: 'D', vehicle: 'V', equipment: 'E', items: 'I', template: 'T', request: 'R' };
const LABEL: Record<MarkerKind, string> = { duty: 'duties', vehicle: 'vehicles', equipment: '{equipment}', items: '{items}', template: 'the usual person', request: 'requests' };

/** Capitalises a label, inside a word token too: "{items}" → "{Items}". */
const cap = (x: string) => x.startsWith('{') ? `{${x[1].toUpperCase()}${x.slice(2)}` : x[0].toUpperCase() + x.slice(1);

/** The business's letters: what it has set, CROP's default for the rest. */
export function markerLetters(stored: unknown): MarkerLetters {
  const out = { ...DEFAULT_MARKER_LETTERS };
  if (stored && typeof stored === 'object') {
    for (const k of MARKER_KINDS) {
      const v = (stored as Record<string, unknown>)[k];
      if (typeof v === 'string' && /^[A-Z0-9]{1,2}$/.test(v)) out[k] = v;
    }
  }
  return out;
}

/**
 * Checks a change of letters: an object of kind → letter; blank or null goes back to CROP's default. One or two
 * capitals or digits (lower case is raised), no two kinds alike, and never F or M (kept for gender).
 * Returns what to store (only the letters that differ from the default) or a plain message.
 */
export function parseMarkerLetters(raw: unknown, current: MarkerLetters): { store: Partial<MarkerLetters>; letters: MarkerLetters } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Letters must be a list of kinds and letters' };
  const next = { ...current };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(MARKER_KINDS as readonly string[]).includes(k)) return { error: `There is no letter for ${k}` };
    const kind = k as MarkerKind;
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) { next[kind] = DEFAULT_MARKER_LETTERS[kind]; continue; }
    const letter = typeof v === 'string' ? v.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{1,2}$/.test(letter)) return { error: `The letter for ${LABEL[kind]} must be one or two letters or numbers` };
    if (letter === 'F' || letter === 'M') return { error: `F and M are kept for gender. Choose another letter for ${LABEL[kind]}` };
    next[kind] = letter;
  }
  const seen = new Map<string, MarkerKind>();
  for (const k of MARKER_KINDS) {
    const other = seen.get(next[k]);
    if (other) return { error: `${cap(LABEL[other])} and ${LABEL[k]} can't both be ${next[k]}` };
    seen.set(next[k], k);
  }
  const store: Partial<MarkerLetters> = {};
  for (const k of MARKER_KINDS) if (next[k] !== DEFAULT_MARKER_LETTERS[k]) store[k] = next[k];
  return { store, letters: next };
}
