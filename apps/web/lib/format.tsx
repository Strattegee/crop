/** Display helpers (Australian formats). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : 'Australia/Melbourne' }).format(d);
}

export const COMPLIANCE_LABEL: Record<string, [string, 'ok' | 'warn' | 'bad']> = {
  compliant: ['Compliant', 'ok'],
  expiring: ['Expiring', 'warn'],
  non_compliant: ['Not compliant', 'bad'],
};

export const CREDENTIAL_STATUS_LABEL: Record<string, [string, 'ok' | 'warn' | 'bad']> = {
  valid: ['Valid', 'ok'],
  expiring: ['Expiring', 'warn'],
  expired: ['Expired', 'bad'],
};

export const VERIFICATION_LABEL: Record<string, [string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  verified: ['Verified', 'ok'],
  unverified: ['Not verified', 'neutral'],
  rejected: ['Rejected', 'bad'],
};

export const PROBLEM_LABEL: Record<string, string> = {
  missing: 'missing',
  rejected: 'rejected — needs a new one',
  unverified: 'not verified yet',
  expired: 'expired',
  expiring: 'expiring soon',
  no_work_rights: 'VEVO does not confirm work rights',
};

export const CATEGORY_LABEL: Record<string, string> = {
  registration: 'Registration',
  check: 'Check',
  training: 'Training',
  vaccination: 'Vaccination',
  licence: 'Licence',
  right_to_work: 'Right to work',
};

export function Badge({ label }: { label: [string, string] | undefined }) {
  if (!label) return null;
  return <span className={`badge ${label[1]}`}>{label[0]}</span>;
}
