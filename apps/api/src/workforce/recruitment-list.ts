/**
 * The recruitment list (David, 5 Nov: "a list with each column having filters … better for volume recruiting"): pure
 * rules for `GET /recruitment/list`. The controller loads everyone in recruitment with a handful of set-based queries;
 * everything here filters, counts, sorts and pages them in memory, so it stays fast with thousands of applicants.
 */
import { appliesTo, type ComplianceIssue, type RequirementRule } from './compliance.js';
import { phoneSearchDigits } from '../notifications/phone.js';

export const LIST_STAGES = ['applied', 'screening', 'interview', 'offer', 'onboarding', 'started', 'not_proceeding'] as const;
export type ListStage = typeof LIST_STAGES[number];
/** Shown when no stage is chosen: everyone still on the way (not started, not not proceeding). */
export const ACTIVE_STAGES: readonly ListStage[] = ['applied', 'screening', 'interview', 'offer', 'onboarding'];
/** Stages where waiting counts (someone has something to do). */
const LIVE: ReadonlySet<ListStage> = new Set(ACTIVE_STAGES);

export const WORK_TYPES = ['full_time', 'part_time', 'casual'] as const;
export const DOCS_FILTERS = ['done', 'missing', 'none', 'to_check'] as const;
export type DocsFilter = typeof DOCS_FILTERS[number];
export const WAITING_FILTERS = ['3', '7', '14', 'action'] as const;
export type WaitingFilter = typeof WAITING_FILTERS[number];
export const SORT_KEYS = ['default', 'name', 'stage', 'applied', 'days', 'docs', 'region'] as const;
export type SortKey = typeof SORT_KEYS[number];
export const SOURCES = ['online', 'office'] as const;

/** No move for this many days = needs action. */
export const STALE_DAYS = 7;
export const LIST_PAGE = 100;
export const LIST_MAX = 5000;
export const NEAR_KMS = [10, 25, 50, 100] as const;

export interface DocProgress {
  /** Must-haves met (verified, not run out). */
  done: number;
  /** Must-haves for their roles, plus right to work. */
  total: number;
  /** Sent but not yet checked by the office. */
  toCheck: number;
  /** Not sent, rejected or run out. */
  missing: number;
}

export interface ListPerson {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  roles: string[];
  stage: ListStage;
  /** When they applied (first recruitment event or the application), ISO. */
  appliedAt: string | null;
  /** When they reached their current stage, ISO. */
  movedAt: string | null;
  days: number | null;
  source: 'online' | 'office';
  workTypes: string[];
  suburb: string | null;
  region: string | null;
  postcode: string | null;
  docs: DocProgress;
  /** km from the chosen site (`near`), when asked for. */
  distanceKm?: number | null;
  /** Within the chosen km of one of the chosen office's sites. */
  inOffice?: boolean;
  onboardingId?: string | null;
}

export interface ListFilter {
  stages: ListStage[];
  roles: string[];
  workTypes: string[];
  states: string[];
  place: string;
  office: string | null;
  near: string | null;
  km: number | null;
  docs: DocsFilter | null;
  waiting: WaitingFilter | null;
  source: 'online' | 'office' | null;
  q: string;
  sort: SortKey;
  desc: boolean;
  limit: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A comma list (or repeated parameter) of values, keeping only the allowed ones. */
function listOf<T extends string>(v: unknown, allowed?: readonly T[]): T[] {
  const raw = (Array.isArray(v) ? v : [v]).flatMap(x => (typeof x === 'string' ? x.split(',') : [])).map(s => s.trim()).filter(Boolean);
  const out = allowed ? raw.filter((s): s is T => (allowed as readonly string[]).includes(s)) : (raw as T[]);
  return [...new Set(out)].slice(0, 100);
}
const one = <T extends string>(v: unknown, allowed: readonly T[]): T | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
};

/** Reads the list's query; anything it doesn't know is ignored (the page's URL is shared and edited by hand). */
export function parseListQuery(q: Record<string, unknown>): ListFilter {
  const stages = listOf(q.stage, LIST_STAGES);
  const sortRaw = typeof q.sort === 'string' ? q.sort.trim() : '';
  const desc = sortRaw.startsWith('-');
  const sort = one(desc ? sortRaw.slice(1) : sortRaw, SORT_KEYS) ?? 'default';
  const limit = Number(q.limit);
  const km = Number(q.km);
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    stages: stages.length ? stages : [...ACTIVE_STAGES],
    roles: listOf(q.role).map(r => r.slice(0, 100)),
    workTypes: listOf(q.work, WORK_TYPES),
    states: listOf(q.state).map(s => s.slice(0, 60)),
    place: text(q.place, 60),
    office: typeof q.office === 'string' && UUID.test(q.office) ? q.office : null,
    near: typeof q.near === 'string' && UUID.test(q.near) ? q.near : null,
    km: Number.isFinite(km) && km > 0 ? Math.min(2000, Math.round(km)) : null,
    docs: one(q.docs, DOCS_FILTERS),
    waiting: one(q.waiting, WAITING_FILTERS),
    source: one(q.source, SOURCES),
    q: text(q.q, 100),
    sort,
    desc: sort === 'default' ? false : desc,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(LIST_MAX, limit) : LIST_PAGE,
  };
}

/** The credential types a hard rule asks of someone with these roles (business-wide or by role; duties don't count here). */
export function mustHaveTypes(roles: string[], rules: RequirementRule[]): Set<string> {
  return new Set(rules.filter(r => r.severity === 'hard' && !r.forDuty && appliesTo(r, roles)).map(r => r.credentialTypeId));
}

/**
 * Documentation progress from their compliance issues: every must-have for their roles plus right to work. Expiring
 * soon still counts as done (it's met today); "unverified" = sent, waiting for the office to check.
 */
export function docProgress(roles: string[], rules: RequirementRule[], issues: Pick<ComplianceIssue, 'severity' | 'problem'>[]): DocProgress {
  const total = mustHaveTypes(roles, rules).size + 1;
  const open = issues.filter(i => i.severity === 'hard' && i.problem !== 'expiring');
  const toCheck = open.filter(i => i.problem === 'unverified').length;
  return { done: Math.max(0, total - open.length), total, toCheck, missing: open.length - toCheck };
}

/** Sent documents waiting to be checked, or no move for a week while still on the way. */
export function needsAction(p: Pick<ListPerson, 'stage' | 'days' | 'docs'>): boolean {
  if (!LIVE.has(p.stage)) return false;
  return p.docs.toCheck > 0 || (p.days ?? 0) >= STALE_DAYS;
}

function docsMatch(d: DocProgress, f: DocsFilter): boolean {
  switch (f) {
    case 'done': return d.missing === 0 && d.toCheck === 0;
    case 'missing': return d.missing > 0;
    case 'none': return d.done === 0;
    case 'to_check': return d.toCheck > 0;
  }
}

/** Lower-case, accents off, for searching names and suburbs. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function textMatch(p: ListPerson, q: string): boolean {
  const needle = fold(q);
  const names = fold([p.firstName, p.lastName, p.preferredName ?? '', `${p.firstName} ${p.lastName}`, `${p.preferredName ?? ''} ${p.lastName}`].join(' | '));
  if (names.includes(needle)) return true;
  if (p.email && p.email.toLowerCase().includes(needle)) return true;
  const digits = phoneSearchDigits(q);
  return !!(digits && p.phone && p.phone.replace(/\D/g, '').includes(digits));
}

/** Whether someone passes every filter (`skipStage` for the stage chips' counts, which ignore the stage filter). */
export function matches(p: ListPerson, f: ListFilter, skipStage = false): boolean {
  if (!skipStage && !f.stages.includes(p.stage)) return false;
  if (f.roles.length && !p.roles.some(r => f.roles.includes(r))) return false;
  if (f.workTypes.length && !p.workTypes.some(w => f.workTypes.includes(w))) return false;
  if (f.states.length && !(p.region && f.states.some(s => s.toLowerCase() === p.region!.toLowerCase()))) return false;
  if (f.place) {
    const needle = fold(f.place);
    if (!fold(`${p.suburb ?? ''} ${p.postcode ?? ''}`).includes(needle)) return false;
  }
  if (f.office && !p.inOffice) return false;
  if (f.near && f.km !== null && !(p.distanceKm !== undefined && p.distanceKm !== null && p.distanceKm <= f.km)) return false;
  if (f.docs && !docsMatch(p.docs, f.docs)) return false;
  if (f.waiting) {
    if (f.waiting === 'action') { if (!needsAction(p)) return false; }
    else if (!(LIVE.has(p.stage) && (p.days ?? 0) > Number(f.waiting))) return false;
  }
  if (f.source && p.source !== f.source) return false;
  if (f.q && !textMatch(p, f.q)) return false;
  return true;
}

/** People per stage, with every filter but the stage (the chips). */
export function stageCounts(people: ListPerson[], f: ListFilter): Record<ListStage, number> {
  const out = Object.fromEntries(LIST_STAGES.map(s => [s, 0])) as Record<ListStage, number>;
  for (const p of people) if (matches(p, f, true)) out[p.stage] += 1;
  return out;
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
const docRatio = (d: DocProgress) => (d.total ? d.done / d.total : 1);
const byName = (a: ListPerson, b: ListPerson) =>
  a.lastName.localeCompare(b.lastName, 'en') || a.firstName.localeCompare(b.firstName, 'en') || a.id.localeCompare(b.id);

/**
 * The list's order. Default: Applied first, newest first (new applications on top), then the other stages in order,
 * each longest-waiting first. Other keys sort the whole list (then by name); `desc` reverses the key.
 */
export function sortPeople(people: ListPerson[], sort: SortKey, desc: boolean): ListPerson[] {
  const stageAt = (p: ListPerson) => LIST_STAGES.indexOf(p.stage);
  const cmp: (a: ListPerson, b: ListPerson) => number = {
    default: (a: ListPerson, b: ListPerson) => {
      if (a.stage !== b.stage) return stageAt(a) - stageAt(b);
      if (a.stage === 'applied') return time(b.movedAt) - time(a.movedAt);
      return (b.days ?? -1) - (a.days ?? -1);
    },
    name: () => 0,
    stage: (a: ListPerson, b: ListPerson) => stageAt(a) - stageAt(b),
    applied: (a: ListPerson, b: ListPerson) => time(a.appliedAt) - time(b.appliedAt),
    days: (a: ListPerson, b: ListPerson) => (a.days ?? -1) - (b.days ?? -1),
    docs: (a: ListPerson, b: ListPerson) => docRatio(a.docs) - docRatio(b.docs) || a.docs.toCheck - b.docs.toCheck,
    region: (a: ListPerson, b: ListPerson) => (a.region ?? '~').localeCompare(b.region ?? '~') || (a.suburb ?? '~').localeCompare(b.suburb ?? '~'),
  }[sort];
  const sign = desc ? -1 : 1;
  return [...people].sort((a, b) => sign * cmp(a, b) || byName(a, b));
}

/** States (address regions) of everyone in recruitment, with how many pass the other filters. */
export function stateChoices(people: ListPerson[]): { value: string; count: number }[] {
  const out = new Map<string, number>();
  for (const p of people) if (p.region) out.set(p.region, (out.get(p.region) ?? 0) + 1);
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
}

/** Everything the list needs from the loaded people: filtered, counted, sorted and paged. */
export function listPage(people: ListPerson[], f: ListFilter) {
  const counts = stageCounts(people, f);
  const matched = sortPeople(people.filter(p => matches(p, f)), f.sort, f.desc);
  const rows = matched.slice(0, f.limit).map(p => ({ ...p, needsAction: needsAction(p) }));
  return { rows, total: matched.length, more: Math.max(0, matched.length - rows.length), counts, states: stateChoices(people) };
}
