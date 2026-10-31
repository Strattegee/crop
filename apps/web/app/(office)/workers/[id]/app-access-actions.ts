'use server';

import { api } from '../../../../lib/api';
import { attempt } from '../../../../lib/actions';

export async function giveAppAccess(workerId: string) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/app-access`, { method: 'POST' }),
    'App access given. They get in the first time they sign in with that email.');
}

export async function removeAppAccess(workerId: string, invited: boolean) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/app-access/remove`, { method: 'POST' }),
    invited ? 'Invitation cancelled.' : 'App access taken away. Their record and shifts stay, and you can give the app again at any time.');
}
