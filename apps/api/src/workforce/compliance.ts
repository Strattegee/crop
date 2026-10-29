/**
 * Compliance rules (spec CRD-2, CRD-4, CRD-7, CRD-8). Pure functions: no database access.
 *
 * - A credential is Valid, Expiring (expiry within the agency's window) or Expired, judged on a given date.
 * - A requirement applies to every worker, or to workers with a given role.
 * - Only a verified credential satisfies a hard requirement. Warnings are reported but don't block.
 * - Optional requirements (migration 0037) are listed for people to see, never checked or warned about.
 * - Checking against a future date (a shift date) treats a credential that expires before then as expired.
 */

export type CredentialStatus = 'valid' | 'expiring' | 'expired';
export type ComplianceStatus = 'compliant' | 'expiring' | 'non_compliant';
export type Problem = 'missing' | 'rejected' | 'unverified' | 'expired' | 'expiring' | 'no_work_rights';
export type Severity = 'hard' | 'warning';
/** How strongly a requirement is asked for: must have (hard), should have (warning), or optional (listed, never checked). */
export type RuleLevel = Severity | 'optional';

export interface RequirementRule {
  credentialTypeId: string;
  typeName: string;
  scope: 'all_workers' | 'role';
  role: string | null;
  severity: RuleLevel;
  /** Set when the rule comes from a duty on a shift (migration 0029), e.g. "Serves alcohol". */
  forDuty?: string;
}

export interface CredentialFacts {
  id: string;
  credentialTypeId: string;
  expiryDate: string | null; // YYYY-MM-DD
  verification: 'unverified' | 'verified' | 'rejected';
}

/** The worker's current right-to-work record (spec CRD-6). */
export interface RightToWorkFacts {
  id: string;
  status: 'citizen' | 'nz_citizen' | 'permanent_resident' | 'visa_holder';
  verification: 'unverified' | 'verified' | 'rejected';
  visaExpiry: string | null; // YYYY-MM-DD, visa holders only
  vevoConfirmed: boolean;
}

export const RIGHT_TO_WORK = { credentialTypeId: 'right-to-work', typeName: 'Right to work' } as const;

/**
 * Right to work is required for every worker and is always a hard rule.
 * Non-citizens need a VEVO check confirming work rights; a visa must be current on the date checked.
 */
export function rightToWorkIssue(rtw: RightToWorkFacts | null, onDate: string, windowDays: number): ComplianceIssue | null {
  const issue = (problem: Problem): ComplianceIssue => ({ ...RIGHT_TO_WORK, severity: 'hard', problem, credentialId: rtw?.id ?? null });
  if (!rtw) return issue('missing');
  if (rtw.verification === 'rejected') return issue('rejected');
  if (rtw.status !== 'citizen' && !rtw.vevoConfirmed) return issue('no_work_rights');
  const visa = rtw.status === 'visa_holder' ? credentialStatus(rtw.visaExpiry, onDate, windowDays) : 'valid';
  if (visa === 'expired') return issue('expired');
  if (rtw.verification !== 'verified') return issue('unverified');
  if (visa === 'expiring') return issue('expiring');
  return null;
}

export interface ComplianceIssue {
  credentialTypeId: string;
  typeName: string;
  severity: Severity;
  problem: Problem;
  credentialId: string | null;
  /** The shift duty that needs this credential, when only a duty does. */
  forDuty?: string;
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date (YYYY-MM-DD) in a time zone, e.g. Australia/Melbourne. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function credentialStatus(expiryDate: string | null, onDate: string, windowDays: number): CredentialStatus {
  if (!expiryDate) return 'valid';
  // Expires at the end of its expiry date.
  if (expiryDate < onDate) return 'expired';
  if (expiryDate <= addDays(onDate, windowDays)) return 'expiring';
  return 'valid';
}

export function appliesTo(rule: RequirementRule, roles: string[]): boolean {
  return rule.scope === 'all_workers' || (rule.role !== null && roles.includes(rule.role));
}

/** Picks the credential that best meets a requirement: verified first, then the latest expiry. */
function best(creds: CredentialFacts[]): CredentialFacts | undefined {
  const rank = (c: CredentialFacts) => (c.verification === 'verified' ? 1 : 0);
  return [...creds].sort((x, y) => {
    if (rank(x) !== rank(y)) return rank(y) - rank(x);
    const ex = x.expiryDate ?? '9999-12-31';
    const ey = y.expiryDate ?? '9999-12-31';
    return ey.localeCompare(ex);
  })[0];
}

export function workerCompliance(
  roles: string[],
  rules: RequirementRule[],
  credentials: CredentialFacts[],
  onDate: string,
  windowDays: number,
  /** Pass null when the worker has no record; leave out only when right to work isn't being checked. */
  rightToWork?: RightToWorkFacts | null,
): { status: ComplianceStatus; issues: ComplianceIssue[] } {
  const issues: ComplianceIssue[] = [];
  if (rightToWork !== undefined) {
    const rtwIssue = rightToWorkIssue(rightToWork, onDate, windowDays);
    if (rtwIssue) issues.push(rtwIssue);
  }
  // If the same type is required more than once (e.g. by role and for everyone), the hard rule wins.
  const byType = new Map<string, RequirementRule & { severity: Severity }>();
  for (const r of rules.filter((r): r is RequirementRule & { severity: Severity } => r.severity !== 'optional' && appliesTo(r, roles))) {
    const prev = byType.get(r.credentialTypeId);
    // A business-wide or role rule is named plainly; a duty is named only when the duty alone asks for it (or asks harder).
    if (!prev || (prev.severity === 'warning' && r.severity === 'hard')) byType.set(r.credentialTypeId, r);
    else if (prev.forDuty && !r.forDuty && prev.severity === r.severity) byType.set(r.credentialTypeId, r);
  }

  for (const rule of byType.values()) {
    const ofType = credentials.filter(c => c.credentialTypeId === rule.credentialTypeId);
    const usable = ofType.filter(c => c.verification !== 'rejected');
    const issue = (problem: Problem, credentialId: string | null = null) =>
      issues.push({ credentialTypeId: rule.credentialTypeId, typeName: rule.typeName, severity: rule.severity, problem, credentialId,
        ...(rule.forDuty ? { forDuty: rule.forDuty } : {}) });

    if (usable.length === 0) {
      issue(ofType.length > 0 ? 'rejected' : 'missing');
      continue;
    }
    const c = best(usable)!;
    const status = credentialStatus(c.expiryDate, onDate, windowDays);
    if (status === 'expired') issue('expired', c.id);
    else if (c.verification !== 'verified') issue('unverified', c.id);
    else if (status === 'expiring') issue('expiring', c.id);
  }

  const blocking = issues.some(i => i.severity === 'hard' && i.problem !== 'expiring');
  const status: ComplianceStatus = blocking ? 'non_compliant' : issues.some(i => i.problem === 'expiring') ? 'expiring' : 'compliant';
  const order: Problem[] = ['missing', 'no_work_rights', 'rejected', 'expired', 'unverified', 'expiring'];
  issues.sort((x, y) => (x.severity === y.severity ? order.indexOf(x.problem) - order.indexOf(y.problem) : x.severity === 'hard' ? -1 : 1));
  return { status, issues };
}

/**
 * The optional requirements that apply to someone (migration 0037): listed so the office can see them, never checked.
 * A credential also asked for at a stronger level is left out (it already shows as an issue or as met).
 * `held` means they have one that isn't rejected or expired on the date.
 */
export function optionalFor(roles: string[], rules: RequirementRule[], credentials: CredentialFacts[], onDate: string):
  { credentialTypeId: string; typeName: string; held: boolean }[] {
  const applying = rules.filter(r => appliesTo(r, roles));
  const stronger = new Set(applying.filter(r => r.severity !== 'optional').map(r => r.credentialTypeId));
  const out = new Map<string, { credentialTypeId: string; typeName: string; held: boolean }>();
  for (const r of applying) {
    if (r.severity !== 'optional' || stronger.has(r.credentialTypeId) || out.has(r.credentialTypeId)) continue;
    const held = credentials.some(c => c.credentialTypeId === r.credentialTypeId && c.verification !== 'rejected'
      && credentialStatus(c.expiryDate, onDate, 0) !== 'expired');
    out.set(r.credentialTypeId, { credentialTypeId: r.credentialTypeId, typeName: r.typeName, held });
  }
  return [...out.values()].sort((a, b) => a.typeName.localeCompare(b.typeName));
}
