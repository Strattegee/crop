/**
 * People in manager mode (per-site access "still to do": supervisors' people, 6 Nov). Read from the same office
 * endpoints as the web's workers list and person page (`GET /workers`, `GET /workers/:id`, `GET /shifts?workerId=`);
 * a supervisor gets the API's limited view (names, roles, credentials without numbers, never contact details) and
 * only the people on their sites. Pure wording helpers, tested in `test/people.spec.ts`; the wording follows the
 * web's employee card (`apps/web/lib/person-card.ts`).
 */

export interface PersonCard {
  nextExpiry: { name: string; date: string } | null; held: string[]; toCheck: number;
  employmentType?: string | null; contractedHours?: number | null; weekHours?: number; nextShift?: { startsAt: string; label: string } | null;
  under18?: boolean;
}

export type Compliance = 'compliant' | 'expiring' | 'non_compliant';

export interface PersonRow {
  id: string; firstName: string; lastName: string; preferredName: string | null; status: string; roles: string[];
  compliance: Compliance; issueCount: number; card?: PersonCard | null;
  /** Office roles only (a supervisor never gets contact details). */
  phone?: string | null; email?: string | null;
}

export interface PersonIssue { credentialTypeId: string; typeName: string; severity: 'hard' | 'warning'; problem: string; forDuty?: string }

export interface PersonCredential {
  id: string; typeName: string; expiryDate: string | null; verification: 'unverified' | 'verified' | 'rejected'; status: 'valid' | 'expiring' | 'expired';
}

export interface PersonDetail extends PersonRow {
  today: string; issues: PersonIssue[]; credentials: PersonCredential[]; limitedView?: boolean;
}

export type PeopleFilter = 'all' | 'not_ready' | 'expiring';
export const PEOPLE_FILTERS: PeopleFilter[] = ['all', 'not_ready', 'expiring'];

/** "Sam Example", with the preferred name when there is one. */
export const personName = (p: Pick<PersonRow, 'firstName' | 'lastName' | 'preferredName'>) => `${p.preferredName || p.firstName} ${p.lastName}`;

/** The compliance light, as on the web's card. */
export const READY: Record<Compliance, { label: string; tone: 'booked' | 'waiting' | 'urgent' }> = {
  compliant: { label: 'Ready to work', tone: 'booked' },
  expiring: { label: 'Something expiring', tone: 'waiting' },
  non_compliant: { label: 'Not ready to work', tone: 'urgent' },
};

const EMPLOYMENT: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual', bank: 'Bank' };
const STATUS_WORD: Record<string, string> = { applicant: 'Applicant', onboarding: 'Onboarding', inactive: 'Inactive', offboarded: 'Offboarded' };

const num = (h: number) => (Number.isInteger(h) ? `${h}` : `${Math.round(h * 100) / 100}`);

/** "18 / 24 h this week", "18 h this week", or null when the card has no hours (a supervisor's view still has them). */
export function hoursLine(c: PersonCard | null | undefined): string | null {
  if (!c || c.weekHours === undefined) return null;
  return c.contractedHours != null ? `${num(c.weekHours)} / ${num(c.contractedHours)} h this week` : `${num(c.weekHours)} h this week`;
}

/** "Carer, Cook · Part-time" plus the status when they aren't simply active. */
export function personLine(p: Pick<PersonRow, 'roles' | 'status' | 'card'>): string {
  return [p.roles.join(', ') || null, p.card?.employmentType ? EMPLOYMENT[p.card.employmentType] ?? null : null, STATUS_WORD[p.status] ?? null]
    .filter(Boolean).join(' · ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "First aid expires in 12 days" (soon within 30 days), as on the web's card. */
export function nextExpiryLine(e: { name: string; date: string } | null | undefined, today: string): { text: string; soon: boolean } | null {
  if (!e) return null;
  const n = daysBetween(today, e.date);
  if (n <= 0) return { text: `${e.name} expires today`, soon: true };
  if (n === 1) return { text: `${e.name} expires tomorrow`, soon: true };
  if (n <= 60) return { text: `${e.name} expires in ${n} days`, soon: n <= 30 };
  const d = new Date(`${e.date}T00:00:00Z`);
  return { text: `${e.name} expires ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, soon: false };
}

const PROBLEM: Record<string, string> = {
  missing: 'missing', rejected: 'not accepted, needs a new one', unverified: 'not checked yet', expired: 'expired', expiring: 'expiring soon',
  no_work_rights: 'work rights not confirmed',
};

/** "First aid: expired", "Right to work: missing (needed for Serving alcohol)". */
export function issueLine(i: PersonIssue): string {
  return `${i.typeName}: ${PROBLEM[i.problem] ?? i.problem}${i.forDuty ? ` (needed for ${i.forDuty})` : ''}`;
}

/** Must-haves first, then should-haves; expiring last within each. */
export function issuesInOrder(list: PersonIssue[]): PersonIssue[] {
  const rank = (i: PersonIssue) => (i.severity === 'hard' ? 0 : 2) + (i.problem === 'expiring' ? 1 : 0);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.typeName.localeCompare(b.typeName));
}

const CHECK: Record<PersonCredential['verification'], string> = { verified: 'Checked', unverified: 'Not checked yet', rejected: 'Not accepted' };

/** "Checked · Expires 1 Dec 2026" / "Not checked yet · No expiry" / "Checked · Expired 3 Nov 2026". */
export function credentialLine(c: PersonCredential): string {
  if (!c.expiryDate) return `${CHECK[c.verification]} · No expiry`;
  const d = new Date(`${c.expiryDate}T00:00:00Z`);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${CHECK[c.verification]} · ${c.status === 'expired' ? 'Expired' : 'Expires'} ${date}`;
}

/** Whether a person matches the search box: any word of their names or roles (case-insensitive). */
export function matchesPerson(p: Pick<PersonRow, 'firstName' | 'lastName' | 'preferredName' | 'roles'>, search: string): boolean {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [p.firstName, p.lastName, p.preferredName ?? '', ...p.roles].join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

/** The people for a filter chip and search, not ready to work first, then by name (the API's order). */
export function peopleShown(list: PersonRow[], filter: PeopleFilter, search: string): PersonRow[] {
  const rank: Record<Compliance, number> = { non_compliant: 0, expiring: 1, compliant: 2 };
  return list
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => (filter === 'all' || (filter === 'not_ready' ? p.compliance === 'non_compliant' : p.compliance === 'expiring')) && matchesPerson(p, search))
    .sort((a, b) => rank[a.p.compliance] - rank[b.p.compliance] || a.i - b.i)
    .map(x => x.p);
}

/** Chip labels with counts: "All 24", "Not ready 3", "Expiring 2". */
export function filterLabel(f: PeopleFilter, list: PersonRow[]): string {
  if (f === 'all') return `All ${list.length}`;
  if (f === 'not_ready') return `Not ready ${list.filter(p => p.compliance === 'non_compliant').length}`;
  return `Expiring ${list.filter(p => p.compliance === 'expiring').length}`;
}
