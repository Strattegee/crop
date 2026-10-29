'use server';

import { api } from '../../../lib/api';
import { attempt } from '../../../lib/actions';

/** Puts one of the business's people forward for a request an employer sent it (agency fill, migration 0042). */
export async function putForward(requestId: string, workerId: string, name: string) {
  let booked = false;
  let employer = 'the employer';
  await attempt('/allocations', async () => {
    const r = await api<{ booked: boolean; employerName: string }>(`/agency-requests/${requestId}/put-forward`, { method: 'POST', body: { workerId } });
    booked = r.booked;
    employer = r.employerName;
  }, () => booked ? `${name} is booked with ${employer}.` : `${name} is put forward. ${employer} approves first; you'll see the answer here.`);
}

/** Takes back the person the business put forward (before the shift starts); the employer's shift opens again. */
export async function pullOut(requestId: string, name: string, employer: string, form: FormData) {
  const reason = String(form.get('reason') ?? '').trim();
  await attempt('/allocations', async () => {
    await api(`/agency-requests/${requestId}/pull-out`, { method: 'POST', body: { reason: reason || undefined } });
  }, `${name} is pulled out. ${employer} has been told and can fill it again.`);
}
