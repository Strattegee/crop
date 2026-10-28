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

/** Ends employment on a last day; shifts they are on after it are counted so the office can find cover. */
export async function endEmployment(workerId: string, f: FormData) {
  let after = 0;
  await attempt(`/workers/${workerId}`, async () => {
    const r = await api<{ shiftsAfter: unknown[] }>(`/workers/${workerId}/employment/end`, {
      method: 'POST', body: { lastDay: str(f, 'lastDay'), reason: str(f, 'reason') },
    });
    after = r.shiftsAfter.length;
  }, () => after === 0
    ? 'Employment ended. They have no shifts after their last day.'
    : `Employment ended. They are still on ${after} shift${after === 1 ? '' : 's'} after their last day: ${after === 1 ? 'it needs' : 'these need'} someone else (see Needs attention on the roster).`);
}

/** Undoes an end of employment recorded by mistake (kept in History as corrected). */
export async function undoEmploymentEnd(workerId: string) {
  await attempt(`/workers/${workerId}`, () => api(`/workers/${workerId}/employment/end/undo`, { method: 'POST', body: {} }),
    'End of employment undone. They can be rostered again.');
}
