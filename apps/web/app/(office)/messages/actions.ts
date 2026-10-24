'use server';

import { api } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';

export async function sendTest(f: FormData) {
  const channel = str(f, 'channel');
  await attempt('/messages', () => api('/notifications/test', { method: 'POST', body: { channel, to: str(f, 'to') } }),
    channel === 'sms' ? 'Test text queued. It should arrive within a minute.' : 'Test email queued. Check your inbox (and spam) in a minute.');
}
