'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

const BACK = '/settings/dashboards';

/** The owner chooses an office person's dashboard and whether they see cost and charge figures. */
export async function setMember(userId: string, f: FormData) {
  const focus = str(f, 'focus');
  await attempt(BACK, () => api(`/team/${userId}`, {
    method: 'PUT', body: { focus: focus || null, seesCosts: f.get('seesCosts') === 'on' },
  }), 'Saved. They see it the next time they open the Dashboard.');
}

/** Saves every target on the form; a blank box clears that target. */
export async function saveTargets(f: FormData) {
  const targets = [...f.keys()].filter(k => k.startsWith('t:')).map(k => {
    const raw = String(f.get(k) ?? '').trim();
    return { key: k.slice(2), value: raw === '' ? null : Number(raw) };
  });
  await attempt(BACK, () => api('/dashboard/targets', { method: 'PUT', body: { targets } }), 'Targets saved.');
}
