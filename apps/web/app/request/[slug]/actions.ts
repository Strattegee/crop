'use server';

import { REQUEST_FIELDS, sendRequest } from '../../../lib/customer-request';

export type SendState = { status: 'idle' | 'sent' | 'error'; message?: string; values?: Record<string, string> };

/** Sends the form to the public API; keeps what was typed when something needs fixing. */
export async function sendCustomerRequest(slug: string, _prev: SendState, formData: FormData): Promise<SendState> {
  const values: Record<string, string> = {};
  for (const k of REQUEST_FIELDS) {
    const v = formData.get(k);
    if (typeof v === 'string') values[k] = v;
  }
  const r = await sendRequest(slug, values);
  return r.ok ? { status: 'sent' } : { status: 'error', message: r.message, values };
}
