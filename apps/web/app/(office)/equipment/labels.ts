export const STATE: Record<string, { label: string; cls: string }> = { ok: { label: 'Up to date', cls: 'ok' }, due_soon: { label: 'Due soon', cls: 'warn' }, overdue: { label: 'Overdue', cls: 'bad' } };
export const EQ_STATUS: Record<string, string> = { active: 'In use', out_of_service: 'Out of service', retired: 'Retired' };
