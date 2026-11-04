'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

/** Only back to the office's own pages. */
const safeBack = (f: FormData) => {
  const b = str(f, 'back') ?? '/dashboard';
  return b.startsWith('/') && !b.startsWith('//') ? b : '/dashboard';
};

/** An owner or admin approves a change the person asked for in the app; it is made and they are told. */
export async function approveDetailChange(f: FormData) {
  await attempt(safeBack(f), () => api(`/detail-changes/${str(f, 'id')}/approve`, { method: 'POST', body: { note: str(f, 'note') } }),
    'Change made. They have been told.');
}

/** Not approved: their details stay as they are; the note goes to them. */
export async function declineDetailChange(f: FormData) {
  await attempt(safeBack(f), () => api(`/detail-changes/${str(f, 'id')}/decline`, { method: 'POST', body: { note: str(f, 'note') } }),
    'Change not approved. They have been told.');
}
