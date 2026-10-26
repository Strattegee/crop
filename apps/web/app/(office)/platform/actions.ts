'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../../../lib/api';
import { redirect } from 'next/navigation';
import { attempt, failTo, str } from '../../../lib/actions';

/** Platform screen (Strattegee staff only; the API checks). */
export async function addBusiness(f: FormData) {
  let id = '';
  try {
    id = (await api<{ id: string }>('/platform/businesses', { method: 'POST', body: { name: str(f, 'name'), ownerEmail: str(f, 'ownerEmail') } })).id;
  } catch (err) {
    failTo('/platform', err);
  }
  revalidatePath('/', 'layout');
  redirect(`/platform/${id}?done=${encodeURIComponent('Business added.')}`);
}

export async function givePerson(id: string, f: FormData) {
  let status = '';
  try {
    status = (await api<{ status: string }>(`/platform/businesses/${id}/people`, { method: 'PUT', body: { email: str(f, 'email'), role: str(f, 'role') } })).status;
  } catch (err) {
    failTo(`/platform/${id}`, err);
  }
  revalidatePath('/', 'layout');
  const done = status === 'active' ? 'Access given. They can use it straight away.' : 'Invited. Access starts the first time they sign in with that email (once it’s verified).';
  redirect(`/platform/${id}?done=${encodeURIComponent(done)}`);
}

export async function changeRole(id: string, email: string, f: FormData) {
  await attempt(`/platform/${id}`, () => api(`/platform/businesses/${id}/people`, { method: 'PUT', body: { email, role: str(f, 'role'), change: true } }), 'Role changed.');
}

export async function removePerson(id: string, email: string) {
  await attempt(`/platform/${id}`, async () => {
    await api(`/platform/businesses/${id}/people/${encodeURIComponent(email)}`, { method: 'DELETE' });
    revalidatePath('/', 'layout');
  }, `${email} no longer has access to this business.`);
}
