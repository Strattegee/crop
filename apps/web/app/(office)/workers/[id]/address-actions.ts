'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

const back = (id: string) => `/workers/${id}?tab=details`;
/** Every field as typed, so a blank clears it on a correction. */
const fields = (f: FormData) => Object.fromEntries(['label', 'line1', 'line2', 'suburb', 'state', 'postcode', 'country']
  .map(k => [k, typeof f.get(k) === 'string' ? (f.get(k) as string) : '']));

export async function addAddress(workerId: string, f: FormData) {
  const current = f.get('current') === 'on' ? true : undefined;
  await attempt(back(workerId), () => api(`/workers/${workerId}/addresses`, { method: 'POST', body: { ...fields(f), current } }), 'Address added.');
}

export async function correctAddress(workerId: string, addressId: string, f: FormData) {
  await attempt(back(workerId), () => api(`/worker-addresses/${addressId}/correct`, { method: 'POST', body: fields(f) }),
    'Address corrected. The earlier version is kept.');
}

export async function makeAddressCurrent(workerId: string, addressId: string) {
  await attempt(back(workerId), () => api(`/worker-addresses/${addressId}/current`, { method: 'POST' }), 'Current address changed.');
}

export async function removeAddress(workerId: string, addressId: string, f: FormData) {
  await attempt(back(workerId), () => api(`/worker-addresses/${addressId}/remove`, { method: 'POST', body: { reason: str(f, 'reason') } }),
    'Address taken off the list. It stays on file.');
}
