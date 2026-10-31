'use server';

import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { attempt, failTo, str } from '../../../lib/actions';

const BACK = '/recruitment';

/** Adds someone straight onto the board at Applied. */
export async function addApplicant(f: FormData) {
  const roles = [...new Set([...f.getAll('roleNames').map(String), ...(str(f, 'roles') ?? '').split(',').map(r => r.trim())].filter(Boolean))];
  let name = '';
  try {
    const w = await api<{ firstName: string; lastName: string }>('/workers', {
      method: 'POST',
      body: { firstName: str(f, 'firstName'), lastName: str(f, 'lastName'), email: str(f, 'email'), phone: str(f, 'phone'), roles, applicant: true },
    });
    name = `${w.firstName} ${w.lastName}`;
  } catch (err) {
    failTo(BACK, err);
  }
  redirect(`${BACK}?done=${encodeURIComponent(`${name} added to Applied.`)}`);
}

export async function moveTo(workerId: string, stage: string, label: string, f: FormData) {
  await moveFrom(BACK, workerId, stage, label, f);
}

/** The same move from another page (the person's page passes its own address so it comes back there). */
export async function moveFrom(back: string, workerId: string, stage: string, label: string, f: FormData) {
  await attempt(back, () => api(`/workers/${workerId}/stage`, { method: 'POST', body: { stage, note: str(f, 'note') } }), label);
}

/** A card dropped on another column of the board (called from the board's client part). */
export async function dropOnStage(workerId: string, stage: string, label: string) {
  await attempt(BACK, () => api(`/workers/${workerId}/stage`, { method: 'POST', body: { stage } }), label);
}

export async function startOnboarding(workerId: string, f: FormData) {
  await startOnboardingFrom(BACK, workerId, f);
}

export async function startOnboardingFrom(back: string, workerId: string, f: FormData) {
  await attempt(back, () => api(`/workers/${workerId}/onboarding`, { method: 'POST', body: { checklistId: str(f, 'checklistId'), hold: true } }),
    'Onboarding started. They stay off the roster until it is finished.');
}
