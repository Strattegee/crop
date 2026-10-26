'use server';

import { api } from '../../../lib/api';
import { failTo } from '../../../lib/actions';
import { redirect } from 'next/navigation';

export async function decideLeave(id: string, to: 'approve' | 'decline' | 'cancel') {
  let rostered = 0;
  try {
    const r = await api<{ rostered?: unknown[] }>(`/leave/${id}/${to}`, { method: 'POST' });
    rostered = r.rostered?.length ?? 0;
  } catch (err) {
    failTo('/leave', err);
  }
  const done = { approve: 'Leave approved.', decline: 'Leave declined.', cancel: 'Leave cancelled. They can be rostered as usual.' }[to]
    + (rostered ? ` They're rostered on ${rostered} shift${rostered === 1 ? '' : 's'} in those days: find cover on the roster.` : '');
  redirect(`/leave?done=${encodeURIComponent(done)}`);
}
