/**
 * The roster's List view (David and Steve, 4 Nov: "a list option on the roster to isolate and work on a list view, as it
 * is easier with a lot of people"). Pure rules for what the list shows: the layout and list state read from the URL,
 * filters, grouping, sorting, paging and the messages after acting on several shifts at once. Tested in
 * test/roster-list.test.ts. The page (`(office)/roster/page.tsx`) renders it beside the cards, from the same data.
 */

export type Layout = 'cards' | 'list';
export type ListGroupBy = 'date' | 'site' | 'area' | 'person' | 'role' | 'stage';
/** Steve's stages (the card ribbon's colours, `stage()` on the roster page). */
export type StageCls = 'unfilled' | 'offered' | 'allocated' | 'accepted' | 'pulled' | 'booked' | 'cancelled';
/** '' = everything but cancelled; `open` = nobody on it yet (unfilled, offered or pulled out). */
export type StageFilter = '' | 'open' | StageCls;

export const STAGE_ORDER: StageCls[] = ['unfilled', 'offered', 'pulled', 'allocated', 'accepted', 'booked', 'cancelled'];
export const STAGE_WORDS: Record<StageCls, string> = {
  unfilled: 'Unfilled', offered: 'Offered', allocated: 'Allocated', accepted: 'To approve', pulled: 'Pulled out', booked: 'Booked', cancelled: 'Cancelled',
};
export const GROUP_BYS: ListGroupBy[] = ['date', 'site', 'area', 'person', 'role', 'stage'];
/** Rows drawn at first (the rest come with "Show more"): keeps a 1,700-shift week quick to open. */
export const LIST_PAGE = 300;
/** The most rows ever drawn at once. */
export const LIST_MAX = 5000;
/** The most shifts one bulk action works through (each is its own API call, one after another). */
export const LIST_BULK_MAX = 60;

/** Start bands for the Time column (local start time): before 6, morning 6–12, afternoon 12–5, evening 5–9, night 9 on. */
export const BANDS = ['early', 'morning', 'afternoon', 'evening', 'night'] as const;
export type Band = typeof BANDS[number];
export const BAND_WORDS: Record<Band, string> = {
  early: 'Before 6 am', morning: 'Morning (6 am–12 pm)', afternoon: 'Afternoon (12–5 pm)', evening: 'Evening (5–9 pm)', night: 'Night (9 pm on)',
};
/** The card's A/P/N letter periods (the same as availability): AM 05:00–11:59, PM 12:00–18:59, night otherwise. */
export const PERIODS = ['am', 'pm', 'night'] as const;
export type Period = typeof PERIODS[number];
export const PERIOD_WORDS: Record<Period, string> = { am: 'AM (A)', pm: 'PM (P)', night: 'Night (N)' };
/** Hours column: under 4, 4 to 8, over 8. */
export const LENGTHS = ['short', 'mid', 'long'] as const;
export type Length = typeof LENGTHS[number];
export const LENGTH_WORDS: Record<Length, string> = { short: 'Under 4 h', mid: '4 to 8 h', long: 'Over 8 h' };
/** Letters column: which markers the card has, plus `ringed` (a marker that doesn't fit). */
export const MARKS = ['gender', 'vehicle', 'equipment', 'items', 'duty', 'template', 'request', 'ringed'] as const;
export type MarkFilter = typeof MARKS[number];
/** T line column. */
export const TLINES = ['away', 'differs', 'none'] as const;
export type TLineFilter = typeof TLINES[number];
export const TLINE_WORDS: Record<TLineFilter, string> = { away: 'Usual person away', differs: 'Someone else on it', none: 'No usual person' };
/** Warnings column. */
export const WARNS = ['blocked', 'gap', 'ringed', 'none'] as const;
export type WarnFilter = typeof WARNS[number];
export const WARN_WORDS: Record<WarnFilter, string> = { blocked: 'Hard block', gap: 'Cover gap', ringed: 'Any ringed marker', none: 'No warnings' };
/** Click a heading to sort within groups; `time` (date and start) is the default. */
export const SORTS = ['time', 'site', 'area', 'role', 'person', 'stage', 'hours'] as const;
export type ListSort = typeof SORTS[number];
/** The stages "Unfilled only" stands for. */
export const OPEN_STAGES: StageCls[] = ['unfilled', 'offered', 'pulled'];

export type ListParams = {
  layout: Layout; group: ListGroupBy; q: string;
  /** Stages shown; [] = everything but cancelled. */
  stages: StageCls[];
  /** Area names ('-' = no area). */
  areas: string[];
  /** '' | 'none' (nobody on it) | 'agency' (agency people) | a person's id. */
  person: string;
  /** Names only (the Staff column's search). */
  who: string;
  days: string[]; bands: Band[]; periods: Period[];
  /** Site ids (only with every site on screen). */
  sites: string[];
  lengths: Length[]; marks: MarkFilter[]; tlines: TLineFilter[]; warns: WarnFilter[];
  /** Project stage ids ('none' = not from a stage). */
  pstages: string[];
  sort: ListSort; desc: boolean; limit: number;
};

export const parseLayout = (v: string | undefined): Layout => v === 'list' ? 'list' : 'cards';

type Raw = string | string[] | undefined;
/** Comma lists or repeated parameters (a GET form's tick boxes repeat the name); trimmed, no repeats. */
export function splitList(v: Raw, max = 100): string[] {
  const raw = (Array.isArray(v) ? v : [v ?? '']).flatMap(x => x.split(',')).map(x => x.trim().slice(0, max)).filter(Boolean);
  return [...new Set(raw)].slice(0, 200);
}
/** Names that themselves hold a comma ("Ward 3, East") come back whole when the pieces make a known name. */
export function joinKnown(tokens: string[], known: string[]): string[] {
  const names = new Set(known);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let found = -1;
    for (let j = tokens.length; j > i + 1; j--) if (names.has(tokens.slice(i, j).join(', ')) || names.has(tokens.slice(i, j).join(','))) { found = j; break; }
    if (found > 0) {
      const a = tokens.slice(i, found).join(', ');
      out.push(names.has(a) ? a : tokens.slice(i, found).join(','));
      i = found - 1;
    } else out.push(tokens[i]!);
  }
  return [...new Set(out)];
}
const only = <T extends string>(v: Raw, allowed: readonly T[]) => splitList(v).filter((x): x is T => (allowed as readonly string[]).includes(x));
const one = (v: Raw) => (Array.isArray(v) ? v[0] ?? '' : v ?? '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "open" (the "Unfilled only" chip) stands for unfilled, offered and pulled out. */
function parseStages(v: Raw): StageCls[] {
  const out = new Set<StageCls>();
  for (const x of splitList(v)) {
    if (x === 'open') OPEN_STAGES.forEach(c => out.add(c));
    else if (STAGE_ORDER.includes(x as StageCls)) out.add(x as StageCls);
  }
  return STAGE_ORDER.filter(c => out.has(c));
}
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(x => b.includes(x));

/**
 * The list's state from the roster URL: `layout=list`, `group`, `q`, `stage`, `area`, `person`, `who`, `day`, `band`, `ap`,
 * `fac`, `len`, `mk`, `tl`, `warn`, `pst`, `sort`, `limit`. Lists are comma lists or repeated parameters. `role` is the
 * strip's (read by the page, resolved with `joinKnown`).
 */
export function parseListParams(sp: Record<string, Raw>): ListParams {
  const groupRaw = one(sp.group);
  const group = GROUP_BYS.includes(groupRaw as ListGroupBy) ? groupRaw as ListGroupBy : 'date';
  const personRaw = one(sp.person);
  const person = personRaw === 'none' || personRaw === 'agency' || UUID.test(personRaw) ? personRaw : '';
  const n = Number(one(sp.limit));
  const limit = Number.isInteger(n) && n > LIST_PAGE ? Math.min(n, LIST_MAX) : LIST_PAGE;
  const sortRaw = one(sp.sort);
  const desc = sortRaw.startsWith('-');
  const sortKey = (desc ? sortRaw.slice(1) : sortRaw) as ListSort;
  const sort: ListSort = SORTS.includes(sortKey) ? sortKey : 'time';
  return {
    layout: parseLayout(one(sp.layout)), group, person, limit,
    q: one(sp.q).trim().slice(0, 80), who: one(sp.who).trim().slice(0, 80),
    stages: parseStages(sp.stage),
    areas: splitList(sp.area),
    days: splitList(sp.day).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort(),
    bands: only(sp.band, BANDS), periods: only(sp.ap, PERIODS),
    sites: splitList(sp.fac).filter(x => UUID.test(x)),
    lengths: only(sp.len, LENGTHS), marks: only(sp.mk, MARKS), tlines: only(sp.tl, TLINES), warns: only(sp.warn, WARNS),
    pstages: splitList(sp.pst).filter(x => x === 'none' || UUID.test(x)),
    sort, desc,
  };
}

/** Every list key of the URL, all off: for the Cards link and anything that leaves the list. */
export const LIST_KEYS = ['layout', 'group', 'q', 'stage', 'area', 'person', 'who', 'day', 'band', 'ap', 'fac', 'len', 'mk', 'tl', 'warn', 'pst', 'sort', 'limit'] as const;
/** The filter keys "Clear filters" turns off (plus the strip's `role`); grouping and sorting stay. */
export const FILTER_KEYS = ['q', 'stage', 'area', 'person', 'who', 'day', 'band', 'ap', 'fac', 'len', 'mk', 'tl', 'warn', 'pst', 'role', 'limit'] as const;
export const offAll = (keys: readonly string[]): Record<string, undefined> => Object.fromEntries(keys.map(k => [k, undefined]));

/** How the stage filter is written: "open" for the Unfilled-only set, else a comma list. */
export function stageParam(stages: StageCls[]): string | undefined {
  if (!stages.length) return undefined;
  return sameSet(stages, OPEN_STAGES) ? 'open' : stages.join(',');
}
const csv = (xs: string[]) => xs.length ? xs.join(',') : undefined;

/** The list's part of a roster URL: only what differs from the defaults, and nothing at all in the cards layout. */
export function listQuery(p: ListParams): Record<string, string | undefined> {
  if (p.layout !== 'list') return offAll(LIST_KEYS);
  return {
    layout: 'list', group: p.group === 'date' ? undefined : p.group, q: p.q || undefined, stage: stageParam(p.stages),
    area: csv(p.areas), person: p.person || undefined, who: p.who || undefined, day: csv(p.days), band: csv(p.bands), ap: csv(p.periods),
    fac: csv(p.sites), len: csv(p.lengths), mk: csv(p.marks), tl: csv(p.tlines), warn: csv(p.warns), pst: csv(p.pstages),
    sort: p.sort === 'time' && !p.desc ? undefined : `${p.desc ? '-' : ''}${p.sort}`,
    limit: p.limit > LIST_PAGE ? String(p.limit) : undefined,
  };
}

/** How many column filters are on (the phone's Filters button and "Clear filters"); `roles` = the strip's role filter. */
export function filterCount(p: ListParams, roles: string[]): number {
  return [p.q || p.who, p.person, p.stages.length, p.areas.length, roles.length, p.days.length + p.bands.length + p.periods.length, p.sites.length,
    p.lengths.length, p.marks.length, p.tlines.length, p.warns.length, p.pstages.length].filter(Boolean).length;
}

/** Clicking a heading: sort by it, or turn the order round when it already sorts by it (hours read longest first). */
export function sortOver(p: ListParams, key: ListSort): { sort: string | undefined; limit: undefined } {
  const desc = p.sort === key ? !p.desc : key === 'hours';
  return { sort: key === 'time' && !desc ? undefined : `${desc ? '-' : ''}${key}`, limit: undefined };
}
export const sortMark = (p: ListParams, key: ListSort) => p.sort === key ? (p.desc ? ' ↓' : ' ↑') : '';

/** The stage chips are presets of the Stage column: All, Unfilled only, or one stage. */
export function chipOn(p: ListParams, chip: '' | 'open' | StageCls): boolean {
  if (chip === '') return p.stages.length === 0;
  if (chip === 'open') return sameSet(p.stages, OPEN_STAGES);
  return sameSet(p.stages, [chip]);
}

/** What the list needs of a shift (a subset of `GET /roster`'s rows). */
export type ListShift = {
  id: string; facilityId: string; facilityName: string; areaName: string | null; role: string; shiftCode?: string | null;
  status: 'open' | 'assigned' | 'booked' | 'cancelled'; localDate: string; localStart: string; localEnd: string; hours: number;
  workerId: string | null; workerName: string | null; equipmentOnly?: boolean; offersPending?: number; pulledOutName?: string | null;
  agencyName?: string | null; usualName?: string | null; coveringName?: string | null;
  /** The project stage a stage's "Roster" made it for (searchable by its name). */
  projectStageId?: string | null; projectStageName?: string | null;
  /** Who usually works it (the T line) and whether they're away that day. */
  usualWorkerId?: string | null; usualAway?: string | null;
};

/**
 * What the list works out for a row before filtering (the page knows the markers, blocks and gaps): marker kinds on the
 * card, whether one is ringed (doesn't fit), a hard block for the person or equipment on it, a cover gap.
 */
export type RowFacts = { marks: MarkFilter[]; ringed: boolean; blocked: boolean; gap: boolean };
const NO_FACTS: RowFacts = { marks: [], ringed: false, blocked: false, gap: false };

/** The start band of a local start time ("06:30" = morning). */
export function bandOf(localStart: string): Band {
  const h = Number(localStart.slice(0, 2));
  return h < 6 ? 'early' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
}
/** The card's A/P/N period of a local start time. */
export function periodOf(localStart: string): Period {
  const h = Number(localStart.slice(0, 2));
  return h >= 5 && h < 12 ? 'am' : h >= 12 && h < 19 ? 'pm' : 'night';
}
export function lengthOf(hours: number): Length {
  return hours < 4 ? 'short' : hours > 8 ? 'long' : 'mid';
}
/** T line facts: the usual person away, someone other than the usual person on it, no usual person. */
export function tlineOf(s: Pick<ListShift, 'usualWorkerId' | 'usualAway' | 'workerId'>): TLineFilter[] {
  if (!s.usualWorkerId) return ['none'];
  const out: TLineFilter[] = [];
  if (s.usualAway) out.push('away');
  if (s.workerId && s.workerId !== s.usualWorkerId) out.push('differs');
  return out;
}

/** The stage colour of a shift, exactly as its card (`stage()` on the roster page uses this). */
export function stageClass(s: Pick<ListShift, 'status' | 'equipmentOnly' | 'agencyName' | 'pulledOutName' | 'offersPending'>): StageCls {
  if (s.status === 'cancelled') return 'cancelled';
  if (s.equipmentOnly) return s.status === 'open' ? 'unfilled' : 'booked';
  if (s.status === 'booked') return 'booked';
  if (s.status === 'assigned') return s.agencyName ? 'accepted' : 'allocated';
  if (s.pulledOutName) return 'pulled';
  if (s.offersPending) return 'offered';
  return 'unfilled';
}

/** Nobody on it and it needs a person (what "unfilled" counts in a group's line). */
export const needsSomeone = (s: ListShift) => s.status === 'open' && !s.equipmentOnly;

const stageMatches = (s: ListShift, stages: StageCls[]) => {
  const c = stageClass(s);
  return stages.length ? stages.includes(c) : c !== 'cancelled';
};

/** Every word of the search must appear in the person, role, area, site, shift type, usual person, covering name or project stage. */
export function matchesSearch(s: ListShift, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [s.workerName, s.role, s.areaName, s.facilityName, s.shiftCode, s.usualName, s.coveringName, s.agencyName, s.projectStageName].filter(Boolean).join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}
/** The Staff column's search: names only (the person, who pulled out, and the agency). */
function matchesWho(s: ListShift, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [s.workerName, s.pulledOutName, s.agencyName].filter(Boolean).join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}
const any = <T>(chosen: T[], test: (x: T) => boolean) => !chosen.length || chosen.some(test);

export type FilterOptions<S> = {
  /** The strip's role filter, resolved with `joinKnown` (several roles from the Role column). */
  roles?: string[];
  /** Marker, block and gap facts per row (rows without facts have none). */
  facts?: (s: S) => RowFacts;
  /** Days on screen in week view: only these days filter (another week's days are ignored); null = no day filter (day view). */
  weekDays?: string[] | null;
  /** Every site on screen: the Site filter applies (with one site chosen it is ignored). */
  allSites?: boolean;
  /** Leave the stage out (the stage chips count what the other filters leave). */
  except?: 'stage';
};

/**
 * The column filters (AND across columns, any of the choices within one). Cancelled shifts show only when the Stage
 * filter asks for them.
 */
export function filterShifts<S extends ListShift>(shifts: S[], p: Omit<ListParams, 'layout' | 'group' | 'sort' | 'desc' | 'limit'>, o: FilterOptions<S> = {}): S[] {
  const roles = o.roles ?? [];
  const days = o.weekDays ? p.days.filter(d => o.weekDays!.includes(d)) : [];
  const sites = o.allSites === false ? [] : p.sites;
  const areas = new Set(p.areas.map(a => a === '-' ? '' : a));
  return shifts.filter(s => {
    if (o.except !== 'stage' && !stageMatches(s, p.stages)) return false;
    if (roles.length && !roles.includes(s.role)) return false;
    if (areas.size && !areas.has(s.areaName ?? '')) return false;
    if (p.person && !(p.person === 'none' ? !s.workerId : p.person === 'agency' ? !!s.agencyName : s.workerId === p.person)) return false;
    if (!matchesWho(s, p.who) || !matchesSearch(s, p.q)) return false;
    if (days.length && !days.includes(s.localDate)) return false;
    if (p.bands.length && !p.bands.includes(bandOf(s.localStart))) return false;
    if (p.periods.length && !p.periods.includes(periodOf(s.localStart))) return false;
    if (sites.length && !sites.includes(s.facilityId)) return false;
    if (p.lengths.length && !p.lengths.includes(lengthOf(s.hours))) return false;
    if (p.tlines.length && !tlineOf(s).some(t => p.tlines.includes(t))) return false;
    if (p.pstages.length && !p.pstages.includes(s.projectStageId ?? 'none')) return false;
    if (p.marks.length || p.warns.length) {
      const f = o.facts?.(s) ?? NO_FACTS;
      if (!any(p.marks, m => m === 'ringed' ? f.ringed : f.marks.includes(m))) return false;
      if (!any(p.warns, w => w === 'blocked' ? f.blocked : w === 'gap' ? f.gap : w === 'ringed' ? f.ringed : !f.blocked && !f.gap && !f.ringed)) return false;
    }
    return true;
  });
}

/** How many shifts are at each stage, plus `open` (nobody on it) and '' (all but cancelled), for the chips. */
export function stageTally(shifts: ListShift[]): Record<StageFilter, number> {
  const out: Record<StageFilter, number> = { '': 0, open: 0, unfilled: 0, offered: 0, allocated: 0, accepted: 0, pulled: 0, booked: 0, cancelled: 0 };
  for (const s of shifts) {
    const c = stageClass(s);
    out[c]++;
    if (c !== 'cancelled') out['']++;
    if (c === 'unfilled' || c === 'offered' || c === 'pulled') out.open++;
  }
  return out;
}

/** Start order: date, start time, then area, role and id so the list never jumps about between refreshes. */
export function byStart(a: ListShift, b: ListShift): number {
  return a.localDate.localeCompare(b.localDate) || a.localStart.localeCompare(b.localStart)
    || (a.areaName ?? '￿').localeCompare(b.areaName ?? '￿') || a.role.localeCompare(b.role) || a.id.localeCompare(b.id);
}

const text = (v: string | null | undefined) => (v ?? '').toLowerCase();
/** Sorting within groups by a column (empty values last either way), ties in start order. */
export function sortBy(key: ListSort, desc: boolean): (a: ListShift, b: ListShift) => number {
  const sign = desc ? -1 : 1;
  const byText = (f: (s: ListShift) => string | null | undefined) => (a: ListShift, b: ListShift) => {
    const x = text(f(a)), y = text(f(b));
    if (!x !== !y) return x ? -1 : 1;
    return sign * x.localeCompare(y) || byStart(a, b);
  };
  switch (key) {
    case 'site': return byText(s => s.facilityName);
    case 'area': return byText(s => s.areaName);
    case 'role': return byText(s => s.role);
    case 'person': return byText(s => s.workerName);
    case 'stage': return (a, b) => sign * (STAGE_ORDER.indexOf(stageClass(a)) - STAGE_ORDER.indexOf(stageClass(b))) || byStart(a, b);
    case 'hours': return (a, b) => sign * (a.hours - b.hours) || byStart(a, b);
    default: return (a, b) => sign * byStart(a, b);
  }
}

export type ListGroup<S extends ListShift> = { key: string; title: string; shifts: S[]; unfilled: number; hours: number };
export type GroupWords = {
  dateLabel: (d: string) => string;
  /** "No area" in the business's words. */
  noArea: string;
  unfilled: string;
  /** Several sites on screen: area groups say which site. */
  allSites: boolean;
};

const LAST = '￿';

/**
 * Groups for the list (Date by default; Site, Area, Person, Role or Stage), each sorted by start then area. Groups come
 * in date order, by stage in Steve's order, "Unfilled" first when grouping by person, and by name otherwise.
 */
export function groupShifts<S extends ListShift>(shifts: S[], by: ListGroupBy, w: GroupWords, sort: { key: ListSort; desc: boolean } = { key: 'time', desc: false }): ListGroup<S>[] {
  const keyed = new Map<string, { title: string; sort: string; shifts: S[] }>();
  for (const s of shifts) {
    let key: string, title: string, sort: string;
    if (by === 'date') { key = s.localDate; title = w.dateLabel(s.localDate); sort = s.localDate; }
    else if (by === 'site') { key = s.facilityId; title = s.facilityName; sort = s.facilityName.toLowerCase(); }
    else if (by === 'area') {
      const area = s.areaName ?? '';
      key = w.allSites ? `${s.facilityId}|${area}` : area;
      title = `${area || w.noArea}${w.allSites ? ` · ${s.facilityName}` : ''}`;
      sort = `${w.allSites ? `${s.facilityName.toLowerCase()}|` : ''}${area ? area.toLowerCase() : LAST}`;
    } else if (by === 'person') {
      key = s.workerId ?? '';
      title = s.workerId ? `${s.workerName ?? ''}${s.agencyName ? ` (${s.agencyName})` : ''}` : w.unfilled;
      sort = s.workerId ? `1${(s.workerName ?? '').toLowerCase()}` : '0';
    } else if (by === 'role') { key = s.role; title = s.role; sort = s.role.toLowerCase(); }
    else { const c = stageClass(s); key = c; title = STAGE_WORDS[c]; sort = String(STAGE_ORDER.indexOf(c)).padStart(2, '0'); }
    const g = keyed.get(key) ?? { title, sort, shifts: [] };
    g.shifts.push(s);
    keyed.set(key, g);
  }
  return [...keyed.entries()]
    .sort(([ka, a], [kb, b]) => a.sort.localeCompare(b.sort) || ka.localeCompare(kb))
    .map(([key, g]) => {
      const list = [...g.shifts].sort(sortBy(sort.key, sort.desc));
      const live = list.filter(s => s.status !== 'cancelled');
      return { key, title: g.title, shifts: list, unfilled: live.filter(needsSomeone).length, hours: live.reduce((t, s) => t + s.hours, 0) };
    });
}

const fmtH = (n: number) => (Math.round(n * 10) / 10).toString();

/** "24 shifts · 3 unfilled · 186 h" (`count` gives "24 shifts" in the business's words). Hours leave out cancelled ones. */
export function groupLine(g: ListGroup<ListShift>, count: (n: number) => string): string {
  return [count(g.shifts.length), g.unfilled ? `${g.unfilled} unfilled` : null, `${fmtH(g.hours)} h`].filter(Boolean).join(' · ');
}

/**
 * The first `limit` rows across the groups in order; every group keeps its full counts and says how many of its rows
 * aren't drawn yet. `hidden` = rows not drawn in all.
 */
export function pageGroups<S extends ListShift>(groups: ListGroup<S>[], limit: number): { groups: (ListGroup<S> & { shown: S[]; notShown: number })[]; hidden: number } {
  let left = limit;
  let hidden = 0;
  const out = groups.map(g => {
    const shown = g.shifts.slice(0, Math.max(0, left));
    left -= shown.length;
    hidden += g.shifts.length - shown.length;
    return { ...g, shown, notShown: g.shifts.length - shown.length };
  });
  return { groups: out, hidden };
}

/** A ticked row's value: the shift and its local date and start, so the action can name it without another call. */
export const pickValue = (s: { id: string; localDate: string; localStart: string }) => `${s.id}|${s.localDate}|${s.localStart}`;

/** Ticked rows from a form, in date order, without repeats or anything that isn't a shift id. */
export function parsePicks(values: string[]): { id: string; date: string; start: string }[] {
  const seen = new Set<string>();
  const out: { id: string; date: string; start: string }[] = [];
  for (const v of values) {
    const [id, date = '', start = ''] = v.split('|');
    if (!/^[0-9a-f-]{36}$/i.test(id ?? '') || seen.has(id!)) continue;
    seen.add(id!);
    out.push({ id: id!, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '', start: /^\d{2}:\d{2}$/.test(start) ? start : '' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/** One shift's result in a bulk action: `label` names it ("Wed 4 Nov 07:00"), `message` says why it didn't go. */
export type BulkOutcome = { label: string; ok: boolean; message?: string };

/**
 * After acting on several ticked shifts: "Confirmed 5 shifts." plus each one that didn't go and why (the API's own
 * reason), the first eight by name. Nothing done is an error.
 */
export function bulkMessage(done: string, results: BulkOutcome[], count: (n: number) => string, notDone = 'Not done'): { done?: string; error?: string } {
  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  const listed = failed.slice(0, 8).map(r => `${r.label}${r.message ? ` (${r.message.replace(/\.$/, '')})` : ''}`).join('; ');
  const notLine = failed.length ? `${notDone} (${failed.length}): ${listed}${failed.length > 8 ? `; and ${failed.length - 8} more` : ''}.` : '';
  if (!ok) return { error: `Nothing changed.${notLine ? ` ${notLine}` : ''}` };
  return { done: `${done} ${count(ok)}.${notLine ? ` ${notLine}` : ''}` };
}
