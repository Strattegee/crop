'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

const back = (workerId: string) => `/workers/${workerId}`;

export async function startOnboarding(workerId: string, f: FormData) {
  const hold = f.get('hold') === 'on';
  await attempt(back(workerId), () => api(`/workers/${workerId}/onboarding`, { method: 'POST', body: { checklistId: str(f, 'checklistId'), hold } }),
    hold ? 'Onboarding started. They stay off the roster until it’s finished.' : 'Onboarding started.');
}

export async function tickStep(workerId: string, onboardingId: string, stepId: string, done: boolean) {
  await attempt(back(workerId), () => api(`/onboardings/${onboardingId}/steps/${stepId}/tick`, { method: 'POST', body: { done } }));
}

export async function finishOnboarding(workerId: string, onboardingId: string) {
  let activated = false;
  await attempt(back(workerId), async () => {
    activated = (await api<{ activated: boolean }>(`/onboardings/${onboardingId}/finish`, { method: 'POST', body: { activate: true } })).activated;
  }, () => (activated ? 'Onboarding finished. They are active and can be rostered.' : 'Onboarding finished.'));
}

export async function stopOnboarding(workerId: string, onboardingId: string, f: FormData) {
  await attempt(back(workerId), () => api(`/onboardings/${onboardingId}/stop`, { method: 'POST', body: { reason: str(f, 'reason') } }), 'Onboarding stopped.');
}
