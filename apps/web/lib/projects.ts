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

/**
 * Projects under clients (David, 5 Nov). The roster's site picker: ordinary sites, then projects in their own group
 * (each with its client's name, so a project can be picked on its own), plus the "+ New project" choice.
 */
export const NEW_PROJECT = '__new';
export type PickerPlace = { id: string; name: string; kind?: string | null; clientName?: string | null; active: boolean };
export function siteChoices(places: PickerPlace[]): { sites: { id: string; name: string }[]; projects: { id: string; name: string }[] } {
  const live = places.filter(p => p.active);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' });
  return {
    sites: live.filter(p => p.kind !== 'project').map(p => ({ id: p.id, name: p.name })).sort(byName),
    projects: live.filter(p => p.kind === 'project').map(p => ({ id: p.id, name: p.clientName ? `${p.name} · ${p.clientName}` : p.name })).sort(byName),
  };
}

/** Where a new project goes from: the roster (back to it, that project on its own, in that week) or a client's page. */
export type NewProjectFrom = { from: 'roster'; week: string | null } | { from: 'client'; clientId: string } | { from: 'projects' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f-]{36}$/i;
export function newProjectFrom(from: string | null | undefined, week: string | null | undefined, clientId: string | null | undefined): NewProjectFrom {
  if (from === 'roster') return { from: 'roster', week: week && DAY.test(week) ? week : null };
  if (from === 'client' && clientId && ID.test(clientId)) return { from: 'client', clientId };
  return { from: 'projects' };
}
/** The page to go back to when the form has a problem. */
export function newProjectRetry(f: NewProjectFrom): string {
  if (f.from === 'roster') return `/roster?site=${NEW_PROJECT}${f.week ? `&week=${f.week}` : ''}`;
  if (f.from === 'client') return `/clients/${f.clientId}?newProject=1`;
  return '/projects?new=1';
}
/** After creating: from the roster, the new project alone on the roster in the same week (a Draft week: nothing published); otherwise its page. */
export function newProjectDone(f: NewProjectFrom, id: string): string {
  return f.from === 'roster' ? `/roster?site=${id}${f.week ? `&week=${f.week}` : ''}` : `/projects/${id}`;
}

/** A client's projects card: current ones first (as the API orders them), archived only counted. */
export function clientProjectsLine(n: { current: number; archived: number }, one: string, many: string): string {
  if (!n.current && !n.archived) return `No ${many.toLowerCase()} yet.`;
  const cur = n.current ? `${n.current} current ${n.current === 1 ? one.toLowerCase() : many.toLowerCase()}` : `No current ${many.toLowerCase()}`;
  return n.archived ? `${cur} · ${n.archived} archived` : cur;
}
