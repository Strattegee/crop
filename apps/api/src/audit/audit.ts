/**
 * The audit log (migration 0055), in plain words. Pure: what each table is called, field names as people say them,
 * and a one-line summary of a row. Values are shown as stored; ids are left out of the field list.
 */
export const TABLE_LABEL: Record<string, string> = {
  workers: 'Person', worker_credentials: 'Credential', credential_documents: 'Credential file', credential_types: 'Credential type',
  credential_requirements: 'Credential rule', right_to_work_records: 'Right to work', employment_terms: 'Employment',
  availability_patterns: 'Usual availability', availability_dates: 'Availability on a date', leave_records: 'Leave',
  shifts: 'Shift', shift_assignments: 'Shift booking', shift_offers: 'Shift offer', shift_codes: 'Shift type',
  shift_duties: 'Shift duty', shift_duty_requirements: 'Shift duty rule', shift_duty_links: 'Duty on a shift',
  site_cover_rules: 'Cover rule', roster_publications: 'Roster published', roster_change_requests: 'Roster change request',
  roster_templates: 'Roster template', roster_template_shifts: 'Template shift', roster_template_equipment: 'Template equipment',
  roster_template_duties: 'Template duty', facilities: 'Site', areas: 'Area', clients: 'Client', equipment: 'Equipment',
  equipment_types: 'Equipment type', equipment_checks: 'Equipment date', items: 'Item', business_roles: 'Role',
  business_terms: 'Words', tenant_settings: 'Settings', memberships: 'Access', invitations: 'Invitation',
  onboarding_checklists: 'Onboarding checklist', onboarding_steps: 'Onboarding step', worker_onboardings: 'Onboarding',
  onboarding_ticks: 'Onboarding step ticked', upload_links: 'Upload link', member_focus: 'Dashboard choice',
  dashboard_targets: 'Dashboard target', industry_pack_applications: 'Industry template applied',
  agency_connections: 'Agency link', agency_credential_maps: 'Agency credential match', agency_invitations: 'Agency invitation',
  agency_requests: 'Agency request', agency_request_rounds: 'Agency request round', agency_inbox: 'Request from an employer',
  agency_placements: 'Agency placement', agency_offers: 'Agency offer', outside_agencies: 'Agency not on CROP',
};

const ACTION_WORD = { insert: 'Added', update: 'Changed', delete: 'Removed' } as const;
/** Fields that say nothing to a person reading the log. */
const QUIET = new Set(['id', 'tenant_id', 'created_at', 'created_by', 'set_at', 'set_by']);

/** "expiry_date" → "Expiry date". */
export function fieldLabel(key: string): string {
  const s = key.replace(/_id$/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface AuditRow {
  tableName: string; action: 'insert' | 'update' | 'delete';
  oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null;
}

/** The fields worth showing, in a stable order. */
export function shownFields(r: AuditRow): string[] {
  const keys = Object.keys((r.action === 'delete' ? r.oldValues : r.newValues) ?? {});
  return keys.filter(k => !QUIET.has(k)).sort();
}

/** "Changed Credential: expiry date, verification". */
export function auditSummary(r: AuditRow): string {
  const what = TABLE_LABEL[r.tableName] ?? fieldLabel(r.tableName);
  const fields = r.action === 'update' ? shownFields(r).map(f => fieldLabel(f).toLowerCase()) : [];
  return `${ACTION_WORD[r.action]} ${what}${fields.length ? `: ${fields.join(', ')}` : ''}`;
}
