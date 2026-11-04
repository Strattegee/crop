'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

const BACK = '/settings/team-access';

/** Saves one person's role (allocator or supervisor) and sites (ticked boxes; none = every site for an allocator). */
export async function saveAccess(userId: string, f: FormData) {
  const facilityIds = f.getAll('facilityId').map(String);
  const role = str(f, 'role');
  await attempt(BACK, () => api(`/site-access/${userId}`, { method: 'PUT', body: { facilityIds, ...(role ? { role } : {}) } }), 'Saved. It applies from their next click.');
}
