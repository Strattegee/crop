'use server';

import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { attempt, failTo, str } from '../../../lib/actions';

const roles = (f: FormData) => (str(f, 'roles') ?? '').split(',').map(r => r.trim().toUpperCase()).filter(Boolean);

export async function addWorker(f: FormData) {
  let id: string | undefined;
  try {
    id = (await api<{ id: string }>('/workers', {
      method: 'POST',
      body: {
        firstName: str(f, 'firstName'), lastName: str(f, 'lastName'), email: str(f, 'email'), phone: str(f, 'phone'), roles: roles(f),
        onboardingChecklistId: str(f, 'onboardingChecklistId'),
      },
    })).id;
  } catch (err) {
    failTo('/workers', err);
  }
  // Optional employment from today (the business's date): full-time, part-time, casual or bank, with hours a week.
  const employmentType = str(f, 'employmentType');
  if (employmentType) {
    const hours = str(f, 'contractedHours');
    try {
      const { timezone } = await api<{ timezone?: string }>('/settings');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Australia/Melbourne' }).format(new Date());
      await api(`/workers/${id}/employment`, { method: 'POST', body: { employmentType, contractedHours: hours === undefined ? null : Number(hours), startsOn: today } });
    } catch (err) {
      if (err && typeof err === 'object' && 'digest' in err) throw err; // Next.js redirect (e.g. to sign in)
      const why = err instanceof Error ? err.message : 'Something went wrong';
      redirect(`/workers/${id}?error=${encodeURIComponent(`Worker added, but their employment wasn't saved: ${why}`)}`);
    }
  }
  const done = str(f, 'onboardingChecklistId') ? 'Worker added and onboarding started. They can be rostered once it’s finished.' : 'Worker added. Now add their credentials.';
  redirect(`/workers/${id}?done=${encodeURIComponent(done)}`);
}

export async function updateWorker(id: string, f: FormData) {
  await attempt(`/workers/${id}`, () => api(`/workers/${id}`, {
    method: 'PATCH',
    body: {
      firstName: str(f, 'firstName'), lastName: str(f, 'lastName'), preferredName: str(f, 'preferredName') ?? null,
      email: str(f, 'email') ?? null, phone: str(f, 'phone') ?? null, roles: roles(f), status: str(f, 'status'),
    },
  }), 'Details saved.');
}

export async function addCredential(workerId: string, f: FormData) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/credentials`, {
    method: 'POST',
    body: {
      credentialTypeId: str(f, 'credentialTypeId'), number: str(f, 'number'), issuedBy: str(f, 'issuedBy'),
      issueDate: str(f, 'issueDate'), expiryDate: str(f, 'expiryDate'), notes: str(f, 'notes'),
    },
  }), 'Credential added. It needs verifying before it counts.');
}

/** Sends every field, so a cleared box clears it; the API leaves the credential alone if nothing changed. */
export async function updateCredential(workerId: string, credentialId: string, f: FormData) {
  let after: { verification?: string } | undefined;
  const before = str(f, 'verificationBefore');
  await attempt(`/workers/${workerId}`, async () => {
    after = await api<{ verification?: string }>(`/workers/${workerId}/credentials/${credentialId}`, {
      method: 'PATCH',
      body: {
        number: str(f, 'number') ?? null, issuedBy: str(f, 'issuedBy') ?? null,
        issueDate: str(f, 'issueDate') ?? null, expiryDate: str(f, 'expiryDate') ?? null, notes: str(f, 'notes') ?? null,
      },
    });
  }, () => before && before !== 'unverified' && after?.verification === 'unverified'
    ? 'Credential saved. It needs checking again before it counts.'
    : 'Credential saved.');
}

export async function verifyCredential(workerId: string, credentialId: string, f: FormData) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/credentials/${credentialId}/verify`, {
    method: 'POST', body: { note: str(f, 'note') },
  }), 'Credential verified.');
}

export async function rejectCredential(workerId: string, credentialId: string, f: FormData) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/credentials/${credentialId}/reject`, {
    method: 'POST', body: { reason: str(f, 'reason') },
  }), 'Credential rejected.');
}

export async function uploadDocument(workerId: string, credentialId: string, f: FormData) {
  const file = f.get('file');
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/workers/${workerId}?error=${encodeURIComponent('Choose a file to upload')}`);
  }
  if (file.size > 10 * 1024 * 1024) {
    redirect(`/workers/${workerId}?error=${encodeURIComponent('That file is too large. The limit is 10 MB.')}`);
  }
  const form = new FormData();
  form.set('file', file, file.name);
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/credentials/${credentialId}/documents`, { method: 'POST', form }), `Uploaded ${file.name}.`);
}

export async function removeDocument(workerId: string, credentialId: string, documentId: string) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/credentials/${credentialId}/documents/${documentId}`, { method: 'DELETE' }), 'Document removed.');
}

export async function saveRightToWork(workerId: string, f: FormData) {
  const hours = str(f, 'workHoursPerFortnight');
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/right-to-work`, {
    method: 'PUT',
    body: {
      status: str(f, 'status'), citizenProofType: str(f, 'citizenProofType'), documentNumber: str(f, 'documentNumber'),
      visaType: str(f, 'visaType'), visaSubclass: str(f, 'visaSubclass'), visaGrantNumber: str(f, 'visaGrantNumber'),
      visaExpiry: str(f, 'visaExpiry'), workLimit: str(f, 'workLimit'), workHoursPerFortnight: hours ? Number(hours) : undefined,
      vevoCheckedOn: str(f, 'vevoCheckedOn'), vevoResult: str(f, 'vevoResult'),
    },
  }), 'Right to work saved. Upload the documents, then it needs verifying.');
}

export async function verifyRightToWork(workerId: string, f: FormData) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/right-to-work/verify`, { method: 'POST', body: { note: str(f, 'note') } }), 'Right to work verified.');
}

export async function rejectRightToWork(workerId: string, f: FormData) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/right-to-work/reject`, { method: 'POST', body: { reason: str(f, 'reason') } }), 'Right to work rejected.');
}

export async function uploadRightToWorkDocument(workerId: string, f: FormData) {
  const file = f.get('file');
  if (!(file instanceof File) || file.size === 0) redirect(`/workers/${workerId}?error=${encodeURIComponent('Choose a file to upload')}`);
  if (file.size > 10 * 1024 * 1024) redirect(`/workers/${workerId}?error=${encodeURIComponent('That file is too large. The limit is 10 MB.')}`);
  const form = new FormData();
  form.set('file', file, file.name);
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/right-to-work/documents`, { method: 'POST', form }), `Uploaded ${file.name}.`);
}

export async function removeRightToWorkDocument(workerId: string, documentId: string) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/right-to-work/documents/${documentId}`, { method: 'DELETE' }), 'Document removed.');
}
