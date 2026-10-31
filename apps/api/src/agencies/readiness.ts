import { workerCompliance, type ComplianceIssue, type CredentialFacts, type RequirementRule, type RightToWorkFacts } from '../workforce/compliance.js';

/**
 * The agency seeing which of its people meet an employer's requirements before any shift arrives (David's answer 1
 * on the agency connections design). Pure: the employer's requirement levels (per role, everyone, duty; from
 * `app_agency_requirement_levels`) are turned into the agency's own credential rules through its matches, then each
 * person is checked against them on a date. Optional requirements are never checked.
 */

export type RequirementLevel = { requirementId: string; kind: 'role' | 'everyone' | 'duty'; label: string; severity: 'hard' | 'warning' | 'optional' };
export type ReadinessGroup = {
  kind: 'role' | 'any' | 'duty';
  /** The employer's role name, "Any role", or the duty's name. */
  label: string;
  rules: RequirementRule[];
  /** The employer's must-haves and should-haves in this group with no match to the agency's credentials. */
  unmatched: Array<{ name: string; severity: 'hard' | 'warning' }>;
};

/**
 * One group per employer role (its role rules plus the rules for everyone), or a single "Any role" group when the
 * employer has no role rules; then one per duty (that duty's own rules only, on top of the role's).
 */
export function readinessGroups(
  levels: RequirementLevel[], liveMatch: Map<string, string>, ownTypeNames: Map<string, string>, employerTypeNames: Map<string, string>,
): ReadinessGroup[] {
  const build = (kind: ReadinessGroup['kind'], label: string, list: RequirementLevel[]): ReadinessGroup => {
    const rules: RequirementRule[] = [];
    const unmatched = new Map<string, { name: string; severity: 'hard' | 'warning' }>();
    for (const l of list) {
      if (l.severity === 'optional') continue;
      const typeId = liveMatch.get(l.requirementId);
      const typeName = typeId ? ownTypeNames.get(typeId) : undefined;
      if (!typeId || !typeName) {
        const prev = unmatched.get(l.requirementId);
        if (!prev || (prev.severity === 'warning' && l.severity === 'hard')) {
          unmatched.set(l.requirementId, { name: employerTypeNames.get(l.requirementId) ?? 'A requirement', severity: l.severity });
        }
        continue;
      }
      // workerCompliance keeps the strongest rule for the same credential.
      rules.push({ credentialTypeId: typeId, typeName, scope: 'all_workers', role: null, severity: l.severity });
    }
    const um = [...unmatched.values()].sort((a, b) => (a.severity === b.severity ? a.name.localeCompare(b.name) : a.severity === 'hard' ? -1 : 1));
    return { kind, label, rules, unmatched: um };
  };
  const everyone = levels.filter(l => l.kind === 'everyone');
  const roles = [...new Set(levels.filter(l => l.kind === 'role').map(l => l.label))].sort((a, b) => a.localeCompare(b));
  const duties = [...new Set(levels.filter(l => l.kind === 'duty').map(l => l.label))].sort((a, b) => a.localeCompare(b));
  const groups = roles.length
    ? roles.map(r => build('role', r, [...levels.filter(l => l.kind === 'role' && l.label === r), ...everyone]))
    : [build('any', 'Any role', everyone)];
  for (const d of duties) {
    const g = build('duty', d, levels.filter(l => l.kind === 'duty' && l.label === d));
    if (g.rules.length || g.unmatched.length) groups.push(g);
  }
  return groups;
}

const PROBLEM: Record<ComplianceIssue['problem'], string> = {
  missing: 'not recorded',
  rejected: 'not accepted',
  unverified: 'not checked yet',
  expired: 'expired',
  expiring: 'expires soon',
  no_work_rights: 'work rights not confirmed (VEVO)',
};

/** "First aid certificate: expired". */
export const issueLine = (i: ComplianceIssue) => `${i.typeName}: ${PROBLEM[i.problem]}`;

export type ReadinessPerson = { workerId: string; name: string; roles: string[] };
export type PersonReadiness = ReadinessPerson & {
  ready: boolean;
  /** Has a role of the same name as the employer's (agencies often name roles differently, so only a hint). */
  hasRole: boolean;
  /** Must-haves not met: these stop them being put forward. */
  missing: string[];
  /** Should-haves not met and anything expiring soon: they could still go. */
  toCheck: string[];
};

/**
 * Each person against one group on a date. Right to work is checked in the role groups (it's needed for any work),
 * not again per duty. A must-have the agency hasn't matched means nobody is ready.
 */
export function personReadiness(
  group: ReadinessGroup, person: ReadinessPerson, credentials: CredentialFacts[], rightToWork: RightToWorkFacts | null,
  onDate: string, windowDays: number,
): PersonReadiness {
  const { issues } = workerCompliance([], group.rules, credentials, onDate, windowDays, group.kind === 'duty' ? undefined : rightToWork);
  const blocking = (i: ComplianceIssue) => i.severity === 'hard' && i.problem !== 'expiring';
  const missing = issues.filter(blocking).map(issueLine);
  const toCheck = issues.filter(i => !blocking(i)).map(issueLine);
  const unmatchedHard = group.unmatched.some(u => u.severity === 'hard');
  return {
    ...person,
    ready: !missing.length && !unmatchedHard,
    hasRole: group.kind === 'role' && person.roles.some(r => r.toLowerCase() === group.label.toLowerCase()),
    missing,
    toCheck,
  };
}

/** Ready first (fewest things to check), then people with the role's name, then fewest missing, then by name. */
export function rankReadiness(list: PersonReadiness[]): PersonReadiness[] {
  return [...list].sort((a, b) =>
    Number(b.ready) - Number(a.ready) || Number(b.hasRole) - Number(a.hasRole)
    || a.missing.length - b.missing.length || a.toCheck.length - b.toCheck.length || a.name.localeCompare(b.name));
}

/** "4 of 12 ready", or why nobody can be. */
export function groupSummary(g: ReadinessGroup, people: PersonReadiness[]): string {
  const hard = g.unmatched.filter(u => u.severity === 'hard');
  if (hard.length) return `Nobody yet: match ${hard.map(u => u.name).join(', ')} first`;
  if (!people.length) return 'You have no active people to check';
  const ready = people.filter(p => p.ready).length;
  return `${ready} of ${people.length} ready`;
}
