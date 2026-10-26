import { cache } from 'react';
import { api } from './api';

/** CROP's numbered concepts; the business chooses the words (Settings → Words we use). Codes: docs/CODES.md. */
export const T = {
  worker: 1010, client: 1015, site: 1020, area: 1030, shift: 1040, roster: 1045,
  credential: 1050, role: 1055, equipment: 1060, item: 1070, bank: 1080, agency: 1090,
} as const;

export type Term = { code: number; key: string; concept: string; singular: string; plural: string; defaultSingular: string; defaultPlural: string };
export type Words = { one: (code: number) => string; many: (code: number) => string; lower: (code: number, plural?: boolean) => string; all: Term[] };

const FALLBACK: Record<number, [string, string]> = {
  1010: ['Worker', 'Workers'], 1015: ['Client', 'Clients'], 1020: ['Site', 'Sites'], 1030: ['Area', 'Areas'], 1040: ['Shift', 'Shifts'],
  1045: ['Roster', 'Rosters'], 1050: ['Credential', 'Credentials'], 1055: ['Role', 'Roles'], 1060: ['Equipment', 'Equipment'],
  1070: ['Item', 'Items'], 1080: ['Bank', 'Bank'], 1090: ['Agency', 'Agencies'],
};

/** The signed-in business's words, fetched once per request. */
export const words = cache(async (): Promise<Words> => {
  let all: Term[] = [];
  try { all = await api<Term[]>('/terms'); } catch { /* fall back to defaults */ }
  const by = new Map(all.map(t => [t.code, t]));
  const one = (c: number) => by.get(c)?.singular ?? FALLBACK[c]?.[0] ?? '';
  const many = (c: number) => by.get(c)?.plural ?? FALLBACK[c]?.[1] ?? '';
  return { one, many, lower: (c, plural) => (plural ? many(c) : one(c)).toLowerCase(), all };
});
