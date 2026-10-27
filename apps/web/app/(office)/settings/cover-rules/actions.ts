'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

const BACK = '/settings/cover-rules';

export async function addCoverRule(f: FormData) {
  await attempt(BACK, () => api('/cover-rules', {
    method: 'POST', body: { credentialTypeId: str(f, 'credentialTypeId'), facilityId: str(f, 'facilityId') ?? null },
  }), 'Rule added. The roster now shows any times nobody on shift holds it.');
}

export async function setCoverRuleActive(id: string, active: boolean) {
  await attempt(BACK, () => api(`/cover-rules/${id}`, { method: 'PATCH', body: { active } }),
    active ? 'Rule switched on.' : 'Rule switched off.');
}
