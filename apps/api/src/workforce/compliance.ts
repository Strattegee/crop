/**
 * Compliance rules (spec CRD-2, CRD-4, CRD-7, CRD-8). Pure functions: no database access.
 *
 * - A credential is Valid, Expiring (expiry within the agency's window) or Expired, judged on a given date.
 * - A requirement applies to every worker, or to workers with a given role.
 * - Only a verified credential satisfies a hard requirement. Warnings are reported but don't block.
 * - Checking against a future date (a shift date) treats a credential that expires before then as expired.
 */

export type CredentialStatus = 'valid' | 'expiring' | 'expired';
export type ComplianceStatus = 'compliant' | 'expiring' | 'non_compliant';
export type Problem = 'missing' | 'rejected' | 'unverified' | 'expired' | 'expiring';
export type Severity = 'hard' | 'warning';

export interface RequirementRule {
  credentialTypeId: string;
  typeName: string;
  scope: 'all_workers' | 'role';
  role: string | null;
  severity: Severity;
}

export interface CredentialFacts {
  id: string;
  credentialTypeId: string;
  expiryDate: string | null; // YYYY-MM-DD
  verification: 'unverified' | 'verified' | 'rejected';
}

export interface ComplianceIssue {
  credentialTypeId: string;
  typeName: string;
  severity: Severity;
  problem: Problem;
  credentialId: string | null;
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
): { status: ComplianceStatus; issues: ComplianceIssue[] } {
  const issues: ComplianceIssue[] = [];
  // If the same type is required more than once (e.g. by role and for everyone), the hard rule wins.
  const byType = new Map<string, RequirementRule>();
  for (const r of rules.filter(r => appliesTo(r, roles))) {
    const prev = byType.get(r.credentialTypeId);
    if (!prev || (prev.severity === 'warning' && r.severity === 'hard')) byType.set(r.credentialTypeId, r);
  }

  for (const rule of byType.values()) {
    const ofType = credentials.filter(c => c.credentialTypeId === rule.credentialTypeId);
    const usable = ofType.filter(c => c.verification !== 'rejected');
    const issue = (problem: Problem, credentialId: string | null = null) =>
      issues.push({ credentialTypeId: rule.credentialTypeId, typeName: rule.typeName, severity: rule.severity, problem, credentialId });

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
  const order: Problem[] = ['missing', 'rejected', 'expired', 'unverified', 'expiring'];
  issues.sort((x, y) => (x.severity === y.severity ? order.indexOf(x.problem) - order.indexOf(y.problem) : x.severity === 'hard' ? -1 : 1));
  return { status, issues };
}
