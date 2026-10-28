import { cache } from 'react';
import { api } from './api';
import { makeWords, type Term, type Words } from './term-words';

export { T, makeWords, type Term, type Words } from './term-words';

/** The signed-in business's words, fetched once per request. */
export const words = cache(async (): Promise<Words> => {
  let all: Term[] = [];
  try { all = await api<Term[]>('/terms'); } catch { /* fall back to defaults */ }
  return makeWords(all);
});
