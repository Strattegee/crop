'use server';

import { redirect } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';

export async function addFacility(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? 'Australia/Melbourne');
  try {
    await api('/facilities', { method: 'POST', body: { name, timezone } });
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Something went wrong';
    redirect(`/facilities?error=${encodeURIComponent(message)}`);
  }
  redirect(`/facilities?added=${encodeURIComponent(name)}`);
}
