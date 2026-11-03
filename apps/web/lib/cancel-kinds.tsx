/**
 * Why a shift was cancelled (David, 3 Nov 2026): the live numbers count "client cancelled" apart from the rest.
 * The kinds match the API's `CANCEL_KINDS` (roster/cancel.ts); keep the two in step.
 */
export type CancelKind = 'client_cancelled' | 'client_withdrew' | 'not_filled' | 'our_mistake' | 'other';

/** The choices in the business's words: the client's two first for a client's shift, else "Other" first. */
export function cancelKindChoices(clientWord: string, forClient: boolean): { value: CancelKind; label: string }[] {
  const c = clientWord.toLowerCase();
  const client = [
    { value: 'client_cancelled' as const, label: `The ${c} cancelled` },
    { value: 'client_withdrew' as const, label: `The ${c} withdrew the request` },
  ];
  const ours = [
    { value: 'not_filled' as const, label: 'We couldn’t fill it' },
    { value: 'our_mistake' as const, label: 'Our mistake' },
  ];
  const other = { value: 'other' as const, label: 'Other' };
  return forClient ? [...client, ...ours, other] : [other, ...ours, ...client];
}

/**
 * The "Why" choice on a cancel form. A client's shift must say (nothing chosen at first); any other shift defaults
 * to Other.
 */
export function CancelKindField({ clientWord, forClient, name = 'kind', label = 'Why' }: { clientWord: string; forClient: boolean; name?: string; label?: string }) {
  return (
    <label>{label}
      <select name={name} required={forClient} defaultValue={forClient ? '' : 'other'}>
        {forClient && <option value="" disabled>Choose…</option>}
        {cancelKindChoices(clientWord, forClient).map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
    </label>
  );
}
