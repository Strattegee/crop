'use server';

import { api } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';

export async function addCredentialType(f: FormData) {
  await attempt('/settings', () => api('/credential-types', {
    method: 'POST',
    body: {
      name: str(f, 'name'), category: str(f, 'category'),
      hasNumber: f.get('hasNumber') === 'on', hasExpiry: f.get('hasExpiry') === 'on',
      verificationMethod: str(f, 'verificationMethod'),
    },
  }), 'Credential type added.');
}

export async function setTypeActive(id: string, active: boolean) {
  await attempt('/settings', () => api(`/credential-types/${id}`, { method: 'PATCH', body: { active } }));
}

export async function addRule(f: FormData) {
  // A role picked from the list, or typed exactly as it appears on people (matching is exact, so no changing case).
  const role = str(f, 'role') ?? str(f, 'roleChoice');
  await attempt('/settings', () => api('/credential-requirements', {
    method: 'POST',
    body: { credentialTypeId: str(f, 'credentialTypeId'), scope: role ? 'role' : 'all_workers', role, severity: str(f, 'severity') },
  }), 'Rule saved.');
}

export async function removeRule(id: string) {
  await attempt('/settings', () => api(`/credential-requirements/${id}`, { method: 'DELETE' }), 'Rule removed.');
}

/** Blank = 0 (distance never counts); anything else goes as typed for the API to check. */
const freeKm = (v: string | null | undefined) => (!v || v.trim() === '' ? 0 : Number(v));

export async function saveSettings(f: FormData) {
  await attempt('/settings', () => api('/settings', {
    method: 'PATCH',
    body: { expiringWindowDays: Number(str(f, 'expiringWindowDays')), timezone: str(f, 'timezone'), country: str(f, 'country'), smsMonthlyCap: Number(str(f, 'smsMonthlyCap')), publishedChanges: str(f, 'publishedChanges'), shiftSwaps: str(f, 'shiftSwaps'), distanceFreeKm: freeKm(str(f, 'distanceFreeKm')) },
  }), 'Settings saved.');
}

/** A role the business uses (it then shows in the roles list, grouped by industry). */
export async function addRole(f: FormData) {
  await attempt('/settings', () => api('/roles', { method: 'POST', body: { name: str(f, 'name'), area: str(f, 'area'), adultsOnly: f.get('adultsOnly') === 'on' } }), 'Role added.');
}

/** Roles set as 18 and over only (migration 0082): only the ones that changed are sent. */
export async function setAdultRoles(f: FormData) {
  const ticked = new Set(f.getAll('adult').map(String));
  const was = new Set(f.getAll('was').map(String));
  const changed = f.getAll('ids').map(String).filter(id => ticked.has(id) !== was.has(id));
  await attempt('/settings', async () => {
    for (const id of changed) await api(`/roles/${id}`, { method: 'PATCH', body: { adultsOnly: ticked.has(id) } });
  }, changed.length ? 'Saved.' : 'Nothing changed.');
}
