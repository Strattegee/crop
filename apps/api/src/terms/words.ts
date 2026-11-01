/**
 * The business's words for messages (emails and texts to staff). Mirrors `apps/web/lib/term-words.ts`.
 * `makeWords` is pure (tested); `wordsFor(db)` loads the business's own words inside `withTenant`.
 * Message wording functions take a `Words` as their last argument and default to CROP's words.
 */
import type { PoolClient } from 'pg';
import { TERMS } from './terms.js';

export const T = {
  worker: 1010, client: 1015, site: 1020, area: 1030, shift: 1040, roster: 1045,
  credential: 1050, role: 1055, equipment: 1060, item: 1070, bank: 1080, agency: 1090,
} as const;

export interface Words {
  /** As the business wrote it, e.g. "Job". */
  one: (code: number) => string;
  many: (code: number) => string;
  /** Lower case, e.g. "job" or "jobs". */
  lower: (code: number, plural?: boolean) => string;
  /** "a job", "an assignment". */
  a: (code: number) => string;
  /** "1 job", "3 jobs". */
  count: (n: number, code: number) => string;
}

export function makeWords(rows: { code: number; singular: string; plural: string }[]): Words {
  const by = new Map(rows.map(r => [r.code, r]));
  const def = new Map(TERMS.map(t => [t.code, t]));
  const one = (c: number) => by.get(c)?.singular?.trim() || def.get(c)?.singular || '';
  const many = (c: number) => by.get(c)?.plural?.trim() || by.get(c)?.singular?.trim() || def.get(c)?.plural || '';
  const lower = (c: number, plural?: boolean) => (plural ? many(c) : one(c)).toLowerCase();
  const a = (c: number) => { const w = lower(c); return `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`; };
  return { one, many, lower, a, count: (n, c) => `${n} ${lower(c, n !== 1)}` };
}

export const DEFAULT_WORDS = makeWords([]);

export async function wordsFor(db: PoolClient): Promise<Words> {
  return makeWords((await db.query<{ code: number; singular: string; plural: string }>('select code, singular, plural from business_terms')).rows);
}

type Filler = (w: Words) => string;
const cap = (x: string) => x ? x[0].toUpperCase() + x.slice(1) : x;
/** Every token, e.g. shift, shifts, Shift, Shifts, a shift, A shift; agency, agencies, Agencies… */
const FILLERS = new Map<string, Filler>();
for (const t of TERMS) {
  const one = t.key, many = t.plural.toLowerCase();
  FILLERS.set(`a ${one}`, w => w.a(t.code));
  FILLERS.set(`A ${one}`, w => cap(w.a(t.code)));
  FILLERS.set(`an ${one}`, w => w.a(t.code));
  FILLERS.set(`An ${one}`, w => cap(w.a(t.code)));
  FILLERS.set(many, w => w.lower(t.code, true));
  FILLERS.set(cap(many), w => w.many(t.code));
  FILLERS.set(one, w => w.lower(t.code));
  FILLERS.set(cap(one), w => w.one(t.code));
}
const TOKEN = /\{([A-Za-z][a-z]*(?: [a-z]+)?)\}/g;

/**
 * Fills word tokens in a message with the business's words. Only tokens change, never anything else
 * (names in a message stay exactly as written). Tokens are CROP's default words in braces:
 * `{shift}` "job", `{shifts}` "jobs", `{Shift}` "Job", `{Shifts}` "Jobs", `{a shift}` "a job", `{A shift}` "A job" (`{an area}` likewise picks a or an from the word),
 * likewise `{site}`, `{worker}`, `{agencies}`… Unknown tokens are left as they are.
 * Used for API error messages (see `WordsInErrorsInterceptor`).
 */
export function fillWords(text: string, w: Words = DEFAULT_WORDS): string {
  if (!text.includes('{')) return text;
  return text.replace(TOKEN, (all, token: string) => { const f = FILLERS.get(token); return f ? f(w) : all; });
}

/** True when a message has word tokens to fill. */
export function hasWordTokens(text: string): boolean {
  return [...text.matchAll(TOKEN)].some(m => FILLERS.has(m[1]));
}
