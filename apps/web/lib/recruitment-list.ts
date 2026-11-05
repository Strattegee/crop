/**
 * The recruitment list (David, 5 Nov: "a list with each column having filters … better for volume recruiting"). Pure
 * helpers, tested in test/recruitment-list.test.ts. The filtering itself happens in the API (`GET /recruitment/list`);
 * this reads and writes the page's URL and words the rows. Keep stages, filters and sorts in step with the API's
 * `workforce/recruitment-list.ts`.
 */

export const LIST_STAGES = ['applied', 'screening', 'interview', 'offer', 'onboarding', 'started', 'not_proceeding'] as const;
export type ListStage = typeof LIST_STAGES[number];
/** What the list shows when no stage is chosen (the API's default too). */
export const ACTIVE_STAGES: ListStage[] = ['applied', 'screening', 'interview', 'offer', 'onboarding'];
export const STAGE_LABEL: Record<ListStage, string> = {
  applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', onboarding: 'Onboarding', started: 'Started',
  not_proceeding: 'Not proceeding',
};
/** Stages a person can be moved to from the list (the board's four). */
export const MOVE_STAGES: ListStage[] = ['applied', 'screening', 'interview', 'offer'];

export const WORK_TYPES = ['full_time', 'part_time', 'casual'] as const;
export const WORK_LABEL: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual', bank: 'Bank' };
export const DOCS_FILTERS = ['done', 'missing', 'none', 'to_check'] as const;
export const DOCS_LABEL: Record<string, string> = {
  done: 'All done', missing: 'Some missing', none: 'None done yet', to_check: 'Sent, waiting for you to check',
};
export const WAITING_FILTERS = ['3', '7', '14', 'action'] as const;
export const WAITING_LABEL: Record<string, string> = {
  '3': 'Over 3 days in stage', '7': 'Over 7 days in stage', '14': 'Over 14 days in stage', action: 'Needs action',
};
export const SOURCE_LABEL: Record<string, string> = { online: 'Applied online', office: 'Added by the office' };
export const SORT_KEYS = ['default', 'name', 'stage', 'applied', 'days', 'docs', 'region'] as const;
export type SortKey = typeof SORT_KEYS[number];
export const KMS = [10, 25, 50, 100] as const;

export const RL_PAGE = 100;
export const RL_MAX = 5000;
/** Up to this many people per bulk action (one call each). */
export const RECRUIT_BULK_MAX = 100;

export type RecruitParams = {
  stages: ListStage[];
  roles: string[];
  work: string[];
  states: string[];
  place: string;
  office: string;
  near: string;
  km: string;
  docs: string;
  waiting: string;
  source: string;
  q: string;
  sort: SortKey;
  desc: boolean;
  limit: number;
};

type Search = Record<string, string | string[] | undefined>;

/** Comma lists or repeated parameters (a GET form's tick boxes repeat the name). */
function many(v: string | string[] | undefined): string[] {
  const raw = (Array.isArray(v) ? v : [v ?? '']).flatMap(x => x.split(',')).map(s => s.trim()).filter(Boolean);
  return [...new Set(raw)];
}
const single = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();
const oneOf = (v: string, allowed: readonly string[]) => (allowed.includes(v) ? v : '');

export function parseRecruitParams(sp: Search): RecruitParams {
  const sortRaw = single(sp.sort);
  const desc = sortRaw.startsWith('-');
  const key = (desc ? sortRaw.slice(1) : sortRaw) as SortKey;
  const sort: SortKey = (SORT_KEYS as readonly string[]).includes(key) ? key : 'default';
  const limit = Number(single(sp.limit));
  return {
    stages: many(sp.stage).filter((s): s is ListStage => (LIST_STAGES as readonly string[]).includes(s)),
    roles: many(sp.role),
    work: many(sp.work).filter(w => (WORK_TYPES as readonly string[]).includes(w)),
    states: many(sp.state),
    place: single(sp.place).slice(0, 60),
    office: single(sp.office),
    near: single(sp.near),
    km: oneOf(single(sp.km), KMS.map(String)),
    docs: oneOf(single(sp.docs), DOCS_FILTERS),
    waiting: oneOf(single(sp.waiting), WAITING_FILTERS),
    source: oneOf(single(sp.source), ['online', 'office']),
    q: single(sp.q).slice(0, 100),
    sort,
    desc: sort !== 'default' && desc,
    limit: Number.isInteger(limit) && limit > RL_PAGE ? Math.min(RL_MAX, limit) : RL_PAGE,
  };
}

/** The URL's parameters for these settings (only what differs from the defaults). */
function entries(p: RecruitParams): [string, string][] {
  const out: [string, string][] = [];
  const add = (k: string, v: string) => { if (v) out.push([k, v]); };
  add('stage', p.stages.join(','));
  add('role', p.roles.join(','));
  add('work', p.work.join(','));
  add('state', p.states.join(','));
  add('place', p.place);
  add('office', p.office);
  add('near', p.near);
  add('km', p.near || p.office ? p.km : '');
  add('docs', p.docs);
  add('waiting', p.waiting);
  add('source', p.source);
  add('q', p.q);
  add('sort', p.sort === 'default' ? '' : `${p.desc ? '-' : ''}${p.sort}`);
  add('limit', p.limit > RL_PAGE ? String(p.limit) : '');
  return out;
}

/** The API's query for the list. */
export function listQuery(p: RecruitParams): string {
  const q = new URLSearchParams(entries(p));
  if (!q.has('limit')) q.set('limit', String(p.limit));
  return `?${q.toString()}`;
}

/** The page's address with some settings changed (paging starts again unless `limit` is given). */
export function recruitHref(p: RecruitParams, over: Partial<RecruitParams> = {}): string {
  const next = { ...p, limit: RL_PAGE, ...over };
  const q = new URLSearchParams(entries(next));
  const s = q.toString();
  return s ? `/recruitment?${s}` : '/recruitment';
}

/** Whether any filter (other than the stage chips and sorting) is on, for "Clear filters". */
export function anyFilter(p: RecruitParams): boolean {
  return !!(p.roles.length || p.work.length || p.states.length || p.place || p.office || p.near || p.docs || p.waiting || p.source || p.q);
}

/** Every filter off, keeping the stage and the order. */
export function clearedHref(p: RecruitParams): string {
  return recruitHref({ ...p, roles: [], work: [], states: [], place: '', office: '', near: '', km: '', docs: '', waiting: '', source: '', q: '' });
}

/** Clicking a column heading: sort by it, or turn the order round when it already sorts by it. */
export function sortHref(p: RecruitParams, key: SortKey): string {
  if (p.sort === key) return recruitHref(p, { desc: !p.desc });
  // Dates and waiting read best newest / longest first.
  return recruitHref(p, { sort: key, desc: key === 'applied' || key === 'days' });
}
export function sortMark(p: RecruitParams, key: SortKey): string {
  return p.sort === key ? (p.desc ? ' ↓' : ' ↑') : '';
}

/** The stage chips: "New applications" (Applied), each stage, plus the default "In progress" set. */
export function stageChips(p: RecruitParams, counts: Record<string, number>): { key: string; label: string; count: number; href: string; on: boolean }[] {
  const shown = p.stages.length ? p.stages : ACTIVE_STAGES;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
  const active = ACTIVE_STAGES.reduce((n, s) => n + (counts[s] ?? 0), 0);
  return [
    { key: 'active', label: 'In progress', count: active, href: recruitHref(p, { stages: [] }), on: same(shown, ACTIVE_STAGES) },
    { key: 'new', label: 'New applications', count: counts.applied ?? 0, href: recruitHref(p, { stages: ['applied'] }), on: same(shown, ['applied']) },
    ...LIST_STAGES.filter(s => s !== 'applied').map(s => ({
      key: s, label: STAGE_LABEL[s], count: counts[s] ?? 0, href: recruitHref(p, { stages: [s] }), on: same(shown, [s]),
    })),
  ];
}

/** A filter heading's summary: "Stage", or "Stage · 2" when two are chosen. */
export function filterSummary(label: string, chosen: number): string {
  return chosen ? `${label} · ${chosen}` : label;
}

export type Docs = { done: number; total: number; toCheck: number; missing: number };

/** "3 of 5", plus what's waiting: "3 of 5 · 1 to check". */
export function docsLine(d: Docs): string {
  return `${d.done} of ${d.total}${d.toCheck ? ` · ${d.toCheck} to check` : ''}`;
}
/** Per cent done, for the bar. */
export const docsPercent = (d: Docs) => (d.total ? Math.round((d.done / d.total) * 100) : 100);

/** Kind of work they want: "Casual, Part-time" or "–". */
export function workLine(types: string[]): string {
  return types.length ? types.map(t => WORK_LABEL[t] ?? t).join(', ') : '–';
}

/** "Geelong VIC 3220", plus "· 12 km" from the chosen site. */
export function placeLine(r: { suburb: string | null; region: string | null; postcode: string | null; distanceKm?: number | null }): string {
  const place = [r.suburb, r.region, r.postcode].filter(Boolean).join(' ');
  const km = r.distanceKm === undefined || r.distanceKm === null ? '' : `${r.distanceKm < 1 ? '<1' : Math.round(r.distanceKm).toLocaleString('en-AU')} km`;
  return [place, km].filter(Boolean).join(' · ') || '–';
}

/** How long they've been where they are: "New today", "4 days in Screening", "Onboarding for 2 days", "Started 3 days ago". */
export function waitLine(stage: string, days: number | null): string {
  if (days === null) return '';
  const d = `${days} day${days === 1 ? '' : 's'}`;
  switch (stage) {
    case 'started': return days === 0 ? 'Started today' : `Started ${d} ago`;
    case 'not_proceeding': return days === 0 ? 'Today' : `${d} ago`;
    case 'onboarding': return days === 0 ? 'Onboarding since today' : `Onboarding for ${d}`;
    case 'applied': return days === 0 ? 'New today' : `${d} since applying`;
    default: return days === 0 ? `Moved to ${STAGE_LABEL[stage as ListStage] ?? stage} today` : `${d} in ${STAGE_LABEL[stage as ListStage] ?? stage}`;
  }
}

/** A short date in the business's time zone: "5 Nov", with the year when it isn't this year. */
export function shortDate(iso: string | null, zone: string, today: string): string {
  if (!iso) return '–';
  const d = new Date(iso);
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric' }).format(d);
  const opts: Intl.DateTimeFormatOptions = { timeZone: zone, day: 'numeric', month: 'short', ...(year !== today.slice(0, 4) ? { year: 'numeric' } : {}) };
  return new Intl.DateTimeFormat('en-AU', opts).format(d);
}

/** "Showing 100 of 1,240 people". */
export function showingLine(shown: number, total: number, people: (n: number) => string): string {
  return shown >= total ? people(total) : `Showing ${shown.toLocaleString('en-AU')} of ${people(total)}`;
}

/** A ticked row's value: id, name, whether they have an email, stage and onboarding id (for asking). */
export function pickValue(r: { id: string; firstName: string; lastName: string; preferredName?: string | null; email: string | null; stage: string; onboardingId?: string | null }): string {
  const name = `${r.preferredName || r.firstName} ${r.lastName}`.replace(/\|/g, ' ');
  return [r.id, name, r.email ? '1' : '0', r.stage, r.onboardingId ?? ''].join('|');
}
export type Pick = { id: string; name: string; hasEmail: boolean; stage: string; onboardingId: string | null };
export function parsePicks(values: string[]): Pick[] {
  const seen = new Set<string>();
  const out: Pick[] = [];
  for (const v of values) {
    const [id, name, email, stage, ob] = v.split('|');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: name || 'Someone', hasEmail: email === '1', stage: stage ?? '', onboardingId: ob || null });
  }
  return out;
}
