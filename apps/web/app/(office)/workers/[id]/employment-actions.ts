'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

/** New employment terms from a date; the current terms end the day before (effective-dated, never overwritten). */
export async function addEmploymentTerms(workerId: string, f: FormData) {
  const hours = str(f, 'contractedHours');
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/employment`, {
    method: 'POST',
    body: { employmentType: str(f, 'employmentType'), contractedHours: hours === undefined ? null : Number(hours), startsOn: str(f, 'startsOn') },
  }), 'Employment saved. The roster uses it from that date.');
}
