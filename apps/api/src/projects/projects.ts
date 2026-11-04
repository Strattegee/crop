/**
 * Projects (David and Steve, 4 Nov; docs/decisions/2026-11-04-projects.md). A project is a site (`facilities.kind =
 * 'project'`) with a code, dates, a status and a manager, plus a team (`site_members`) and equipment allocated to it
 * for a period (`equipment_site_allocations`). Pure rules here; the database steps are in the controllers.
 */
import { fmtDate } from '../roster/eligibility.js';

export const SITE_KINDS = ['site', 'project'] as const;
export type SiteKind = typeof SITE_KINDS[number];
export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned', active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived',
};
export const TEAM_ROLES = ['supervisor', 'worker'] as const;
export type TeamRole = typeof TEAM_ROLES[number];

/** A date range, both ends inclusive; `to` null = no end yet. */
export interface DateRange { from: string; to: string | null }

/** Whether two inclusive date ranges share a day. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return (a.to === null || b.from <= a.to) && (b.to === null || a.from <= b.to);
}

/** Whether a range covers a date. */
export const covers = (r: DateRange, d: string) => r.from <= d && (r.to === null || d <= r.to);

/**
 * The status and active flag to store. A site has no status; a project is active (in the pickers) unless archived.
 * Changing the kind to project starts it as active (or planned when it starts later); changing it back clears it.
 */
export function kindAndStatus(
  cur: { kind: SiteKind; status: ProjectStatus | null; active: boolean } | null,
  given: { kind?: SiteKind | null; status?: ProjectStatus | null; active?: boolean | null; startsOn?: string | null },
  today: string,
): { kind: SiteKind; status: ProjectStatus | null; active: boolean } {
  const kind = given.kind ?? cur?.kind ?? 'site';
  if (kind === 'site') {
    // A site has no status (the caller refuses one); only its active flag.
    return { kind, status: null, active: given.active ?? cur?.active ?? true };
  }
  let status = given.status ?? (cur?.kind === 'project' ? cur.status : null);
  if (!status) status = given.active === false ? 'archived' : given.startsOn && given.startsOn > today ? 'planned' : 'active';
  // Switching a project off = archiving it; switching it back on brings it back as active.
  if (!given.status && given.active === false) status = 'archived';
  if (!given.status && given.active === true && status === 'archived') status = 'active';
  return { kind, status, active: status !== 'archived' };
}

/**
 * The change a team membership or allocation can have. Refusals in plain words (null = fine).
 * `others` are the person's (or equipment's) other live entries at the same site (team) or anywhere (equipment).
 */
export function rangeProblem(r: DateRange): string | null {
  if (r.to !== null && r.to < r.from) return 'The end date is before the start date';
  return null;
}

export interface AllocationFact extends DateRange { id: string; facilityId: string; siteName: string }

/** The first live allocation (other than `exceptId`) that shares a day with the range. */
export function clashingAllocation(range: DateRange, others: AllocationFact[], exceptId?: string): AllocationFact | null {
  return others.find(o => o.id !== exceptId && rangesOverlap(range, o)) ?? null;
}

export const untilWords = (to: string | null) => (to ? ` until ${fmtDate(to)}` : '');

/** "Excavator 2 is already allocated to Smith St from Mon 9 Nov until Fri 20 Nov". */
export function allocationClashMessage(equipmentName: string, a: AllocationFact): string {
  return `${equipmentName} is already allocated to ${a.siteName} from ${fmtDate(a.from)}${untilWords(a.to)}`;
}

/**
 * The block for booking equipment onto a shift at one site while it is allocated to another on the shift's local
 * date (double booking across projects). Null when it isn't allocated anywhere that day, or is allocated here.
 */
export function allocatedElsewhere(equipmentName: string, shiftFacilityId: string, localDate: string, allocations: AllocationFact[]): string | null {
  const a = allocations.find(x => covers(x, localDate));
  if (!a || a.facilityId === shiftFacilityId) return null;
  return `${equipmentName} is allocated to ${a.siteName}${untilWords(a.to)}`;
}

/** "Ends Fri 20 Nov" / "From Mon 9 Nov" / "Mon 9 Nov – Fri 20 Nov" for a membership or allocation. */
export function rangeLine(r: DateRange, today: string): string {
  if (r.from > today) return r.to ? `${fmtDate(r.from)} – ${fmtDate(r.to)}` : `From ${fmtDate(r.from)}`;
  if (r.to && r.to < today) return `Ended ${fmtDate(r.to)}`;
  return r.to ? `Until ${fmtDate(r.to)}` : 'No end date';
}

/**
 * Team first, never a block (eligibility unchanged): within each eligibility group (ready, warnings, not available,
 * can't), people on the site's team come first; otherwise the list keeps its order.
 */
export function teamFirst<C extends { eligible: boolean; available?: boolean; warnings: unknown[]; onTeam: boolean }>(list: C[]): C[] {
  const group = (c: C) => (!c.eligible ? 3 : c.available === false ? 2 : c.warnings.length ? 1 : 0);
  return list.map((c, i) => ({ c, i }))
    .sort((a, b) => group(a.c) - group(b.c) || Number(b.c.onTeam) - Number(a.c.onTeam) || a.i - b.i)
    .map(x => x.c);
}

/** One line about a project's dates, e.g. "Mon 9 Nov – Fri 30 Apr", "From Mon 9 Nov", "Due Fri 30 Apr". */
export function projectDates(startsOn: string | null, endsOn: string | null, thisYear?: string): string | null {
  // Years show when the dates span years or aren't this year (projects run for months).
  const years = new Set([startsOn, endsOn].filter((d): d is string => Boolean(d)).map(d => d.slice(0, 4)));
  const withYear = years.size > 1 || (thisYear !== undefined && [...years].some(y => y !== thisYear));
  const f = (d: string) => (withYear ? `${fmtDate(d)} ${d.slice(0, 4)}` : fmtDate(d));
  if (startsOn && endsOn) return `${f(startsOn)} – ${f(endsOn)}`;
  if (startsOn) return `From ${f(startsOn)}`;
  if (endsOn) return `Due ${f(endsOn)}`;
  return null;
}
