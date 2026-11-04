/**
 * Projects (David and Steve, 4 Nov; docs/decisions/2026-11-04-projects.md): pure helpers for the Projects list and
 * a project's page. A project is a site of kind "project"; keep the statuses and team roles in step with the API's
 * `apps/api/src/projects/projects.ts`.
 */
export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned', active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived',
};
/** Badge tone per status (classes from lib/format's Badge). */
export const STATUS_TONE: Record<ProjectStatus, 'ok' | 'warn' | 'neutral'> = {
  planned: 'neutral', active: 'ok', on_hold: 'warn', completed: 'neutral', archived: 'neutral',
};
/** For `Badge`. */
export const statusBadge = (s: ProjectStatus | null | undefined): [string, string] | undefined => (s ? [STATUS_LABEL[s], STATUS_TONE[s]] : undefined);
export const TEAM_ROLE_LABEL: Record<string, string> = { supervisor: 'Supervisor', worker: 'Worker' };

export const PROJECT_TABS = ['overview', 'team', 'areas', 'equipment', 'consumables'] as const;
export type ProjectTab = typeof PROJECT_TABS[number];
export const parseProjectTab = (v: string | undefined): ProjectTab => (PROJECT_TABS as readonly string[]).includes(v ?? '') ? v as ProjectTab : 'overview';

/** The statuses shown on the list's filter: live ones by default, archived on its own. */
export function listFilter(v: string | undefined): 'live' | 'archived' | 'all' {
  return v === 'archived' || v === 'all' ? v : 'live';
}

/**
 * Links that open the screens CROP already has, narrowed to the project: the roster at its site (this week), the
 * allocation queue for its client (only shifts at clients' sites are there), Live numbers for its office.
 */
export function projectLinks(p: { id: string; clientId: string | null; officeId: string | null }, weekStart: string) {
  return {
    roster: `/roster?site=${p.id}&week=${weekStart}`,
    template: `/roster/template?site=${p.id}`,
    allocations: p.clientId ? `/allocations?clientId=${p.clientId}` : null,
    live: p.officeId ? `/dashboard/live?office=${p.officeId}` : null,
  };
}

/** "12 rostered · 10 filled · 2 unfilled", or "Nothing rostered". */
export function dayLine(d: { rostered: number; filled: number; unfilled: number }, shiftsWord: string): string {
  if (!d.rostered) return 'Nothing rostered';
  return [`${d.rostered} ${shiftsWord}`, `${d.filled} filled`, d.unfilled ? `${d.unfilled} unfilled` : null].filter(Boolean).join(' · ');
}

/** "3 on the team · 2 pieces of equipment" style counts, leaving out zeros. */
export function countsLine(parts: [number, string, string][]): string {
  const out = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return out.length ? out.join(' · ') : '';
}

/** Work areas as typed in the new-project form: one per line or comma, trimmed, no repeats (case-insensitive), at most 30. */
export function parseAreaList(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text ?? '').split(/[\n,]/)) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.slice(0, 30);
}

/** The equipment that can be offered for a new allocation: not retired, not already on this project now or later. */
export function allocatable<E extends { id: string; status: string }>(all: E[], onProject: { equipmentId: string; state: string }[]): E[] {
  const here = new Set(onProject.filter(a => a.state !== 'ended').map(a => a.equipmentId));
  return all.filter(e => e.status !== 'retired' && !here.has(e.id));
}

/** People who can join the team: active or being onboarded, not already on it now or later. */
export function joinable<W extends { id: string; status: string }>(all: W[], team: { workerId: string; state: string }[]): W[] {
  const on = new Set(team.filter(m => m.state !== 'ended').map(m => m.workerId));
  return all.filter(w => (w.status === 'active' || w.status === 'onboarding') && !on.has(w.id));
}
