'use server';

import { api } from '../../../../lib/api';
import { attempt, failTo, str } from '../../../../lib/actions';
import { redirect } from 'next/navigation';

/** Choices offered for a day: stored as a list of periods (am, pm, night). */
const CHOICES: Record<string, string[] | null> = {
  '': null, any: ['am', 'pm', 'night'], none: [], am: ['am'], pm: ['pm'], night: ['night'], ampm: ['am', 'pm'], pmnight: ['pm', 'night'],
};

export async function savePattern(workerId: string, f: FormData) {
  const days = [1, 2, 3, 4, 5, 6, 7].flatMap(d => {
    const periods = CHOICES[str(f, `day-${d}`) ?? ''];
    return periods ? [{ weekday: d, periods }] : [];
  });
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/availability/pattern`, { method: 'PUT', body: { days } }), 'Usual availability saved.');
}

export async function saveDate(workerId: string, f: FormData) {
  const date = str(f, 'date');
  const periods = CHOICES[str(f, 'choice') ?? 'none'] ?? [];
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/availability/dates/${date}`, { method: 'PUT', body: { periods, note: str(f, 'note') } }), 'Saved for that date.');
}

export async function clearDate(workerId: string, date: string) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/availability/dates/${date}`, { method: 'DELETE' }), 'Back to their usual availability that day.');
}

export async function addLeave(workerId: string, f: FormData) {
  let rostered = 0;
  let approved = false;
  try {
    const r = await api<{ status: string; rostered?: unknown[] }>(`/workers/${workerId}/leave`, {
      method: 'POST',
      body: { kind: str(f, 'kind'), startsOn: str(f, 'startsOn'), endsOn: str(f, 'endsOn') ?? str(f, 'startsOn'), note: str(f, 'note'), approved: f.get('approved') === 'on' },
    });
    rostered = r.rostered?.length ?? 0;
    approved = r.status === 'approved';
  } catch (err) {
    failTo(`/workers/${workerId}`, err);
  }
  const msg = `${approved ? 'Leave approved' : 'Leave request recorded'}.${rostered ? ` They're rostered on ${rostered} shift${rostered === 1 ? '' : 's'} in those days: find cover on the roster.` : ''}`;
  redirect(`/workers/${workerId}?done=${encodeURIComponent(msg)}`);
}
