/**
 * The allocation queue's column filters and sorting (David, 7 Nov: "add filters [to the headings] as per what you have
 * done on Recruitment"). Pure helpers, tested in test/queue-filters.test.ts: reading and writing the URL, the choices
 * and their words. The filtering, counting and paging happen in the API (`GET /allocations/queue`); keep the names and
 * values in step with `parseColumnFilters`/`parseSort` in the API's `clients/allocation-queue.ts`.
 */

/** URL parameter → its values (several for multi-selects, one for the rest). Names are the API's. */
export type QueueFilters = {
  band: string[]; waiting: string; stages: string[]; rank: string[]; clients: string[]; sites: string[]; area: string;
  roles: string[]; dates: string[]; part: string[]; hrs: string; progress: string[]; on: string;
};
export const NO_QUEUE_FILTERS: QueueFilters = {
  band: [], waiting: '', stages: [], rank: [], clients: [], sites: [], area: '', roles: [], dates: [], part: [], hrs: '', progress: [], on: '',
};
const MULTI = ['band', 'stages', 'rank', 'clients', 'sites', 'roles', 'dates', 'part', 'progress'] as const;
const SINGLE = ['waiting', 'area', 'hrs', 'on'] as const;

export const BAND_LABEL: Record<string, string> = {
  started: 'Started or overdue', soon: 'Within 2 hours', today: 'Later today', tomorrow: 'Tomorrow', later: 'Later', done: 'Ended or cancelled',
};
export const WAITING_LABEL: Record<string, string> = { '30m': 'Over 30 min', '1h': 'Over 1 hour', '4h': 'Over 4 hours', '1d': 'Over a day' };
export const HRS_LABEL: Record<string, string> = { lt4: 'Under 4', '4to8': '4 to 8', gt8: 'Over 8' };
export const PROGRESS_LABEL: Record<string, string> = {
  not_offered: 'Not offered yet', no_replies: 'Offered, no replies', some_declined: 'Some declined', pulled_out: 'Pulled out',
};
export const PART_LABEL: Record<string, string> = { am: 'AM', pm: 'PM', night: 'Night' };
export const ON_LABEL: Record<string, string> = { others: 'Someone else has it open', nobody: 'Nobody else' };
export const RANK_CHOICES = ['1', '2', '3', '4', '5', '6', '7', 'none'] as const;
export const rankLabel = (r: string) => (r === 'none' ? 'Not ranked' : r === '1' ? '1 (most loyal)' : r === '7' ? '7 (fill-in)' : r);

const MULTI_ALLOWED: Partial<Record<typeof MULTI[number], readonly string[]>> = {
  band: Object.keys(BAND_LABEL), rank: RANK_CHOICES, part: Object.keys(PART_LABEL), progress: Object.keys(PROGRESS_LABEL),
};
const SINGLE_ALLOWED: Partial<Record<typeof SINGLE[number], readonly string[]>> = {
  waiting: Object.keys(WAITING_LABEL), hrs: Object.keys(HRS_LABEL), on: Object.keys(ON_LABEL),
};

export const SORT_KEYS = ['starts', 'waiting', 'stage', 'rank', 'client', 'site', 'area', 'role', 'when', 'hours', 'progress', 'on'] as const;
export type SortKey = typeof SORT_KEYS[number];
export const SORT_LABEL: Record<SortKey, string> = {
  starts: 'starts in', waiting: 'waiting', stage: 'stage', rank: 'rank', client: 'client', site: 'site', area: 'area', role: 'role', when: 'when', hours: 'hours', progress: 'progress', on: 'who has it open',
};

type Search = Record<string, string | string[] | undefined>;
function many(v: string | string[] | undefined): string[] {
  const raw = (Array.isArray(v) ? v : [v ?? '']).flatMap(x => x.split(',')).map(s => s.trim()).filter(Boolean);
  return [...new Set(raw)].slice(0, 100);
}
const single = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** Reads the column filters from the page's URL (anything odd is left out). */
export function parseQueueFilters(sp: Search): QueueFilters {
  const f: QueueFilters = { ...NO_QUEUE_FILTERS };
  for (const k of MULTI) {
    let v = many(sp[k]);
    const allowed = MULTI_ALLOWED[k];
    if (allowed) v = v.filter(x => allowed.includes(x));
    if (k === 'clients' || k === 'sites') v = v.filter(isId).map(x => x.toLowerCase());
    if (k === 'dates') v = v.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (k === 'stages') v = v.filter(s => /^[a-z_]{2,30}$/.test(s));
    f[k] = v;
  }
  for (const k of SINGLE) {
    const v = single(sp[k]).slice(0, 60);
    const allowed = SINGLE_ALLOWED[k];
    f[k] = allowed && !allowed.includes(v) ? '' : v;
  }
  return f;
}

/** `?sort=`: a column key, `-key` turned round; null = the queue's own order. */
export function parseQueueSort(v: string | string[] | undefined): string | null {
  const s = single(v);
  const key = s.startsWith('-') ? s.slice(1) : s;
  return (SORT_KEYS as readonly string[]).includes(key) ? s : null;
}

/** The URL (and API) parameters for the filters that are on. */
export function filterEntries(f: QueueFilters | undefined): [string, string][] {
  if (!f) return [];
  const out: [string, string][] = [];
  for (const k of MULTI) if (f[k].length) out.push([k, f[k].join(',')]);
  for (const k of SINGLE) if (f[k]) out.push([k, f[k]]);
  return out;
}

/** How many columns have a filter on (the phone's "Filters (3)"). */
export function filtersOn(f: QueueFilters | undefined): number {
  if (!f) return 0;
  const cols = [f.band.length, f.waiting, f.stages.length, f.rank.length, f.clients.length || f.sites.length || f.area, f.roles.length,
    f.dates.length || f.part.length, f.hrs, f.progress.length, f.on];
  return cols.filter(Boolean).length;
}

/** Clicking a heading: sort by it; again turns it round; a third time goes back to the queue's own order. */
export function nextSort(current: string | null | undefined, key: SortKey): string | null {
  if (current === key) return `-${key}`;
  if (current === `-${key}`) return null;
  return key;
}
export function sortMark(current: string | null | undefined, key: SortKey): string {
  return current === key ? ' ↑' : current === `-${key}` ? ' ↓' : '';
}
/** "Sorted by rank, highest first" style heading for a sorted list. */
export function sortedLine(current: string, words: { client: string; role: string; site?: string; area?: string }): string {
  const desc = current.startsWith('-');
  const key = (desc ? current.slice(1) : current) as SortKey;
  const word = key === 'client' ? words.client : key === 'role' ? words.role : key === 'site' ? words.site : key === 'area' ? words.area : undefined;
  const name = word ? word.toLowerCase() : SORT_LABEL[key];
  return `Sorted by ${name}${desc ? ', turned round' : ''}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sat 7 Nov" for a local date (YYYY-MM-DD). */
export function dateChoiceLabel(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y!, m! - 1, day!)).getUTCDay()]} ${day} ${MONTHS[m! - 1]}`;
}

/** The heading's summary of what's chosen: "Any", one name, or "3 chosen". */
export function chosenSummary(chosen: string[], label: (v: string) => string): string {
  if (!chosen.length) return 'Any';
  if (chosen.length === 1) return label(chosen[0]!);
  return `${chosen.length} chosen`;
}

export type FilterOptions = {
  stages: string[]; clients: { id: string; name: string }[]; sites: { id: string; name: string; clientId: string }[]; roles: string[]; dates: string[];
};
/**
 * Choices for a column, keeping anything already chosen even when it isn't in the rows any more (so it can be
 * unticked). `labelOf` names a value that only the URL knows.
 */
export function withChosen(options: { value: string; label: string }[], chosen: string[], labelOf: (v: string) => string = v => v): { value: string; label: string }[] {
  const out = [...options];
  for (const c of chosen) if (!out.some(o => o.value === c)) out.push({ value: c, label: labelOf(c) });
  return out;
}

/** The area heading's summary. */
export function areaSummary(f: QueueFilters): string {
  return f.area ? `“${f.area}”` : 'Any';
}
/** The "Client · site · area" heading's summary: the chosen names, or "Any". */
export function placeSummary(f: QueueFilters, o: FilterOptions): string {
  const names = [
    ...f.clients.map(id => o.clients.find(c => c.id.toLowerCase() === id)?.name),
    ...f.sites.map(id => o.sites.find(s => s.id.toLowerCase() === id)?.name),
    ...(f.area ? [`“${f.area}”`] : []),
  ];
  if (!names.length) return 'Any';
  const known = names.filter((n): n is string => Boolean(n));
  return names.length <= 2 && known.length === names.length ? known.join(', ') : `${names.length} chosen`;
}
/** The When heading's summary. */
export function whenSummary(f: QueueFilters): string {
  const parts = [...f.dates.map(dateChoiceLabel), ...f.part.map(p => PART_LABEL[p] ?? p)];
  if (!parts.length) return 'Any';
  return parts.length <= 2 ? parts.join(', ') : `${parts.length} chosen`;
}
