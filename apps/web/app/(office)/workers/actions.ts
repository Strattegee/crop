'use server';

import { redirect } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';

const roles = (f: FormData) => (str(f, 'roles') ?? '').split(',').map(r => r.trim().toUpperCase()).filter(Boolean);

export async function addWorker(f: FormData) {
  let id: string | undefined;
  try {
    id = (await api<{ id: string }>('/workers', {
      method: 'POST',
      body: { firstName: str(f, 'firstName'), lastName: str(f, 'lastName'), email: str(f, 'email'), phone: str(f, 'phone'), roles: roles(f) },
    })).id;
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
    redirect(`/workers?error=${encodeURIComponent(message)}`);
  }
  redirect(`/workers/${id}?done=${encodeURIComponent('Worker added. Now add their credentials.')}`);
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
      credentialTypeId: str(f, 'credentialTypeId'), number: str(f, 'number'),
      issueDate: str(f, 'issueDate'), expiryDate: str(f, 'expiryDate'), notes: str(f, 'notes'),
    },
  }), 'Credential added. It needs verifying before it counts.');
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
