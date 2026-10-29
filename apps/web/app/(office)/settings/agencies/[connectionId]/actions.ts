'use server';

import { api } from '../../../../../lib/api';
import { attempt } from '../../../../../lib/actions';

/** Saves the matches on the form: a choice per requirement (`m:<id>`), blank = not matched; only changes are sent. */
export async function saveMatches(connectionId: string, f: FormData) {
  const back = `/settings/agencies/${connectionId}`;
  const matches: Array<{ requirementId: string; credentialTypeId: string | null }> = [];
  for (const id of f.getAll('req').map(String)) {
    const chosen = String(f.get(`m:${id}`) ?? '');
    const current = String(f.get(`cur:${id}`) ?? '');
    if (chosen === current) continue;
    matches.push({ requirementId: id, credentialTypeId: chosen || null });
  }
  if (matches.length === 0) await attempt(back, async () => undefined, 'Nothing changed.');
  let status = '';
  await attempt(back, async () => {
    const r = await api<{ link: { status: string; unmatched: number } }>(`/agency-links/${connectionId}/matches`, { method: 'PUT', body: { matches } });
    status = r.link.status === 'active' ? 'Saved. Every requirement is matched, so requests can now be sent to you.'
      : `Saved. ${r.link.unmatched} still to match before requests can be sent.`;
  }, () => status);
}
