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

/** Fixes a mistaken entry (type, hours, or the latest terms' start date). The old entry is kept, marked corrected. */
export async function correctEmploymentTerms(workerId: string, termsId: string, f: FormData) {
  const hours = str(f, 'contractedHours');
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/employment/${termsId}/correct`, {
    method: 'POST',
    body: { employmentType: str(f, 'employmentType'), contractedHours: hours === undefined ? null : Number(hours), startsOn: str(f, 'startsOn') ?? null },
  }), 'Employment corrected. The roster uses the corrected terms.');
}

/** Withdraws the latest terms entered by mistake; the terms before them carry on. */
export async function withdrawEmploymentTerms(workerId: string, termsId: string) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/employment/${termsId}/withdraw`, { method: 'POST', body: {} }),
    'Employment entry withdrawn. The terms before it carry on.');
}
