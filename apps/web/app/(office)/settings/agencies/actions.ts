'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '../../../../lib/api';
import { attempt, failTo, str } from '../../../../lib/actions';
import { authConfig } from '../../../../lib/config';

import { BACK, NEW_LINK_COOKIE } from './invite-cookie';

export async function createInvite(f: FormData) {
  let link: string;
  try {
    const r = await api<{ link: string | null; token: string }>('/agency-links/invitations', { method: 'POST', body: { forName: str(f, 'forName') ?? null } });
    link = r.link ?? `${authConfig().appUrl.replace(/\/$/, '')}/agency-invite/${r.token}`;
  } catch (err) {
    failTo(BACK, err);
  }
  (await cookies()).set(NEW_LINK_COOKIE, link, {
    httpOnly: true, secure: authConfig().appUrl.startsWith('https://'), sameSite: 'strict', path: BACK, maxAge: 120,
  });
  redirect(`${BACK}?done=${encodeURIComponent('Invitation link made. Copy it now: it is shown only once.')}`);
}

export async function cancelInvite(id: string) {
  await attempt(BACK, () => api(`/agency-links/invitations/${id}/cancel`, { method: 'POST' }), 'Invitation cancelled. The link no longer works.');
}

export async function moveAgency(order: string[], from: number, to: number) {
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  await attempt(BACK, () => api('/agency-links/order', { method: 'PUT', body: { connectionIds: next } }), 'Order saved.');
}

export async function setBookMode(connectionId: string, f: FormData) {
  await attempt(BACK, () => api(`/agency-links/${connectionId}`, { method: 'PATCH', body: { bookMode: str(f, 'bookMode') } }), 'Saved.');
}

export async function endLink(connectionId: string, f: FormData) {
  await attempt(BACK, () => api(`/agency-links/${connectionId}/end`, { method: 'POST', body: { reason: str(f, 'reason') ?? null } }),
    'Link ended. Both businesses keep its history.');
}

export async function setTiming(f: FormData) {
  const n = (k: string) => { const v = Number(str(f, k)); return Number.isInteger(v) && v > 0 ? v : undefined; };
  await attempt(BACK, () => api('/settings', { method: 'PATCH', body: { agencyTiming: { soonMinutes: n('soonMinutes'), todayMinutes: n('todayMinutes'), laterMinutes: n('laterMinutes') } } }),
    'Timing saved. It applies to requests sent from now on.');
}

/** Agencies not on CROP (migration 0059): the business's list, emailed shifts from the roster's shift panel. */
export async function addOutsideAgency(f: FormData) {
  await attempt(BACK, () => api('/outside-agencies', { method: 'POST', body: {
    name: str(f, 'name'), email: str(f, 'email'), phone: str(f, 'phone'), notes: str(f, 'notes'),
  } }), 'Added. You can now email it shifts from the roster.');
}

export async function saveOutsideAgency(id: string, f: FormData) {
  await attempt(BACK, () => api(`/outside-agencies/${id}`, { method: 'PATCH', body: {
    name: str(f, 'name'), email: str(f, 'email'), phone: str(f, 'phone') ?? null, notes: str(f, 'notes') ?? null,
  } }), 'Saved.');
}

export async function switchOutsideAgency(id: string, active: boolean) {
  await attempt(BACK, () => api(`/outside-agencies/${id}`, { method: 'PATCH', body: { active } }), active ? 'Switched on.' : 'Switched off. It keeps its history.');
}
