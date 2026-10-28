// Pure part of the business's words (no server imports), so it can be tested.
/** CROP's numbered concepts; the business chooses the words (Settings → Words we use). Codes: docs/CODES.md. */
export const T = {
  worker: 1010, client: 1015, site: 1020, area: 1030, shift: 1040, roster: 1045,
  credential: 1050, role: 1055, equipment: 1060, item: 1070, bank: 1080, agency: 1090,
} as const;

export type Term = { code: number; key: string; concept: string; singular: string; plural: string; defaultSingular: string; defaultPlural: string };
export type Words = {
  one: (code: number) => string; many: (code: number) => string; lower: (code: number, plural?: boolean) => string;
  /** "1 shift", "3 shifts", in the business's words, lower case. */
  count: (n: number, code: number) => string;
  all: Term[];
};

const FALLBACK: Record<number, [string, string]> = {
  1010: ['Worker', 'Workers'], 1015: ['Client', 'Clients'], 1020: ['Site', 'Sites'], 1030: ['Area', 'Areas'], 1040: ['Shift', 'Shifts'],
  1045: ['Roster', 'Rosters'], 1050: ['Credential', 'Credentials'], 1055: ['Role', 'Roles'], 1060: ['Equipment', 'Equipment'],
  1070: ['Item', 'Items'], 1080: ['Bank', 'Bank'], 1090: ['Agency', 'Agencies'],
};

/** Words from a business's term list, falling back to CROP's defaults (pure, tested). */
export function makeWords(all: Term[]): Words {
  const by = new Map(all.map(t => [t.code, t]));
  const one = (c: number) => by.get(c)?.singular || FALLBACK[c]?.[0] || '';
  const many = (c: number) => by.get(c)?.plural || FALLBACK[c]?.[1] || '';
  const lower = (c: number, plural?: boolean) => (plural ? many(c) : one(c)).toLowerCase();
  return { one, many, lower, count: (n, c) => `${n} ${lower(c, n !== 1)}`, all };
}

