'use server';

import { headers } from 'next/headers';
import { answersFromForm, filesFrom, keptValues, sendApplication, type CustomQuestion } from '../../../lib/apply';

export type ApplyState = { status: 'idle' | 'sent' | 'error'; message?: string; values?: Record<string, string[]> };

/**
 * Sends the application to the public API as one multipart request: the answers as JSON, the form's "opened at"
 * stamp, the trap field, the Turnstile token when there is one, and the files. Keeps what was typed when something
 * needs fixing (files have to be chosen again).
 */
export async function sendApply(slug: string, custom: CustomQuestion[], _prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const out = new FormData();
  out.set('answers', JSON.stringify(answersFromForm(formData, custom)));
  for (const k of ['formToken', 'website']) {
    const v = formData.get(k);
    if (typeof v === 'string') out.set(k, v);
  }
  const t = formData.get('cf-turnstile-response');
  if (typeof t === 'string' && t) out.set('turnstile', t);
  for (const { field, file } of filesFrom(formData.entries())) out.append(field, file, file.name);
  // The applicant's address as Caddy passed it to us (the API keeps only a keyed hash of it).
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const r = await sendApplication(slug, out, ip);
  return r.ok ? { status: 'sent' } : { status: 'error', message: r.message, values: keptValues(formData.entries()) };
}
