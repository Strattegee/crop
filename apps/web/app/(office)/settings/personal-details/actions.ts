'use server';

import { api } from '../../../../lib/api';
import { attempt } from '../../../../lib/actions';
import { accessFromForm, type FieldAccessRow } from '../../../../lib/field-access';

const BACK = '/settings/personal-details';

export async function saveFieldAccess(f: FormData) {
  await attempt(BACK, async () => {
    const { fields } = await api<{ fields: FieldAccessRow[] }>('/field-access');
    await api('/field-access', { method: 'PUT', body: { fields: accessFromForm(fields, k => f.get(k)?.toString() ?? null) } });
  }, 'Saved.');
}
