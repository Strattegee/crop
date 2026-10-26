'use server';

import { api } from '../../../lib/api';
import { revalidatePath } from 'next/cache';
import { attempt } from '../../../lib/actions';

/** Saves the business's words. A blank singular puts that concept back to CROP's default. */
export async function saveTerms(form: FormData) {
  const codes = form.getAll('code').map(Number);
  const terms = codes.map(code => {
    const singular = String(form.get(`singular-${code}`) ?? '').trim();
    const plural = String(form.get(`plural-${code}`) ?? '').trim();
    // "Ticket" with no plural becomes "Tickets"; words already ending in s stay as they are.
    return { code, singular, plural: plural || (singular && !/s$/i.test(singular) ? `${singular}s` : singular) };
  });
  await attempt('/settings', async () => { await api('/terms', { method: 'PUT', body: { terms } }); revalidatePath('/', 'layout'); }, 'Words saved. Menus and screens now use them.');
}
