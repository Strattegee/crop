'use server';

import { api } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';

/** An owner or admin approves a shift swap both people agreed in the app (made through the usual rules). */
export async function approveSwap(f: FormData) {
  await attempt('/dashboard', () => api(`/shift-swaps/${str(f, 'id')}/approve`, { method: 'POST' }), 'Swap made. Both people have been emailed.');
}

/** Not approved: both stay on their own shifts and are told (the note stays with the office). */
export async function refuseSwap(f: FormData) {
  await attempt('/dashboard', () => api(`/shift-swaps/${str(f, 'id')}/refuse`, { method: 'POST', body: { reason: str(f, 'reason') } }),
    'Swap not approved. Both people have been emailed.');
}
