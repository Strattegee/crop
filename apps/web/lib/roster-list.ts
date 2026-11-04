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

export type ListParams = { layout: Layout; group: ListGroupBy; q: string; stage: StageFilter; area: string; person: string; limit: number };

export const parseLayout = (v: string | undefined): Layout => v === 'list' ? 'list' : 'cards';

/** The list's state from the roster URL (`layout=list`, `group`, `q`, `stage`, `area`, `person`, `limit`). */
export function parseListParams(sp: { layout?: string; group?: string; q?: string; stage?: string; area?: string; person?: string; limit?: string }): ListParams {
  const group = GROUP_BYS.includes(sp.group as ListGroupBy) ? sp.group as ListGroupBy : 'date';
  const stage: StageFilter = sp.stage === 'open' || STAGE_ORDER.includes(sp.stage as StageCls) ? sp.stage as StageFilter : '';
  const person = sp.person === 'none' || /^[0-9a-f-]{36}$/i.test(sp.person ?? '') ? sp.person! : '';
  const n = Number(sp.limit);
  const limit = Number.isInteger(n) && n > LIST_PAGE ? Math.min(n, LIST_MAX) : LIST_PAGE;
  return {
    layout: parseLayout(sp.layout), group, stage, person, limit,
    q: (sp.q ?? '').trim().slice(0, 80), area: (sp.area ?? '').trim().slice(0, 100),
  };
}

/** The list's part of a roster URL: only what differs from the defaults, and nothing at all in the cards layout. */
export function listQuery(p: ListParams): Record<string, string | undefined> {
  if (p.layout !== 'list') return { layout: undefined, group: undefined, q: undefined, stage: undefined, area: undefined, person: undefined, limit: undefined };
  return {
    layout: 'list', group: p.group === 'date' ? undefined : p.group, q: p.q || undefined, stage: p.stage || undefined,
    area: p.area || undefined, person: p.person || undefined, limit: p.limit > LIST_PAGE ? String(p.limit) : undefined,
  };
}

/** What the list needs of a shift (a subset of `GET /roster`'s rows). */
export type ListShift = {
  id: string; facilityId: string; facilityName: string; areaName: string | null; role: string; shiftCode?: string | null;
  status: 'open' | 'assigned' | 'booked' | 'cancelled'; localDate: string; localStart: string; localEnd: string; hours: number;
  workerId: string | null; workerName: string | null; equipmentOnly?: boolean; offersPending?: number; pulledOutName?: string | null;
  agencyName?: string | null; usualName?: string | null; coveringName?: string | null;
};

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

const stageMatches = (s: ListShift, f: StageFilter) => {
  const c = stageClass(s);
  if (f === '') return c !== 'cancelled';
  if (f === 'open') return c === 'unfilled' || c === 'offered' || c === 'pulled';
  return c === f;
};

/** Every word of the search must appear in the person, role, area, site, shift type, usual person or covering name. */
export function matchesSearch(s: ListShift, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [s.workerName, s.role, s.areaName, s.facilityName, s.shiftCode, s.usualName, s.coveringName, s.agencyName].filter(Boolean).join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

/**
 * Filters for the list. `role` is the strip's role filter (`role` in the URL), so it carries between the two layouts.
 * `stage` is left out by `except: 'stage'` (the stage chips count what the other filters leave).
 */
export function filterShifts<S extends ListShift>(shifts: S[], p: Pick<ListParams, 'q' | 'stage' | 'area' | 'person'>, role: string, except?: 'stage'): S[] {
  return shifts.filter(s =>
    (except === 'stage' || stageMatches(s, p.stage))
    && (!role || s.role === role)
    && (!p.area || (s.areaName ?? '') === (p.area === '-' ? '' : p.area))
    && (!p.person || (p.person === 'none' ? !s.workerId : s.workerId === p.person))
    && matchesSearch(s, p.q));
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
export function groupShifts<S extends ListShift>(shifts: S[], by: ListGroupBy, w: GroupWords): ListGroup<S>[] {
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
      const list = [...g.shifts].sort(byStart);
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
