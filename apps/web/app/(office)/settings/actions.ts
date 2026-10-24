'use server';

import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { attempt, failTo, str } from '../../../lib/actions';

export async function addStarterSet() {
  let result = { typesAdded: 0, rulesAdded: 0 };
  try {
    result = await api('/credential-types/starter-set', { method: 'POST' });
  } catch (err) {
    failTo('/settings', err);
  }
  redirect(`/settings?done=${encodeURIComponent(`Added ${result.typesAdded} credential types and ${result.rulesAdded} suggested rules.`)}`);
}

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
  const role = str(f, 'role')?.toUpperCase();
  await attempt('/settings', () => api('/credential-requirements', {
    method: 'POST',
    body: { credentialTypeId: str(f, 'credentialTypeId'), scope: role ? 'role' : 'all_workers', role, severity: str(f, 'severity') },
  }), 'Rule saved.');
}

export async function removeRule(id: string) {
  await attempt('/settings', () => api(`/credential-requirements/${id}`, { method: 'DELETE' }), 'Rule removed.');
}

export async function saveSettings(f: FormData) {
  await attempt('/settings', () => api('/settings', {
    method: 'PATCH',
    body: { expiringWindowDays: Number(str(f, 'expiringWindowDays')), timezone: str(f, 'timezone') },
  }), 'Settings saved.');
}
