'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

const back = (id: string) => `/workers/${id}?tab=credentials`;

export async function sendUploadLink(workerId: string, f: FormData) {
  let sent: string[] = [];
  await attempt(back(workerId), async () => {
    sent = (await api<{ sent: string[] }>(`/workers/${workerId}/upload-link`, { method: 'POST', body: { note: str(f, 'note'), sms: f.get('sms') === 'on' } })).sent;
  }, () => `Upload link sent by ${sent.join(' and ') || 'message'}.`);
}

export async function stopUploadLink(workerId: string) {
  await attempt(back(workerId), () => api(`/workers/${workerId}/upload-link/stop`, { method: 'POST' }), 'Link stopped. It no longer works.');
}
