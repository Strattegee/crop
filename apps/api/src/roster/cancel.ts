/**
 * Why a shift was cancelled (David, 3 Nov 2026, answer 1): the live numbers count "client cancelled" apart from the
 * rest. Pure: no database access.
 */
export type CancelKind = 'client_cancelled' | 'client_withdrew' | 'not_filled' | 'our_mistake' | 'other';
export const CANCEL_KINDS: readonly CancelKind[] = ['client_cancelled', 'client_withdrew', 'not_filled', 'our_mistake', 'other'];
/** The kinds the dashboard counts as "client cancelled". */
export const CLIENT_CANCEL_KINDS: readonly CancelKind[] = ['client_cancelled', 'client_withdrew'];

/** Plain words for each kind, with the business's words as tokens ({client}, {shift}). */
export const CANCEL_KIND_WORDS: Record<CancelKind, string> = {
  client_cancelled: 'The {client} cancelled',
  client_withdrew: 'The {client} withdrew the request',
  not_filled: 'We couldn’t fill it',
  our_mistake: 'Our mistake',
  other: 'Other',
};
