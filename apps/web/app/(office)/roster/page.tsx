import Link from 'next/link';
import { cookies } from 'next/headers';
import { api } from '../../../lib/api';
import { Notices } from '../notices';
import { T, words, type Words } from '../../../lib/terms';
import { businessSettings, businessZone, todayIn, whenIn } from '../../../lib/business';
import {
  applyTemplate, archiveTemplate, assign, setFullView, bookEquipment, cancelShift, confirm, copyMonth, copyWeek, createShifts, decideChange, fillWeekDemo, loadDemoWeek, offer, publishWeek,
  recordReply, removeEquipment, requestChange, returnItem, saveTemplate, setCovering, setDuties, unassign, useItem,
} from './actions';
import { AttentionPanel } from './attention-panel';
import { SiteSelect } from './site-select';
import { DropZone, RibbonStrip, type StripEquip, type StripItem, type StripPerson } from './strip';
import {
  LOOKS, ROSTER_FULL_COOKIE, anchorForSwitch, anchorOf, barPosition, coveringChoices, coveringLine, dayWindow, daySummary, detailLines, lanes, mondayOf, monthCopyWeeks, parseLook, parseSpan, shiftItemChoices, simpleLine, rangeFor, tickLabel, weekStateLabel, weeksOf, type Span,
} from './view';

export const dynamic = 'force-dynamic';

type Attention = {
  days: number; total: number; urgent: number; truncated: boolean;
  items: {
    shiftId: string; kind: 'person_blocked' | 'equipment_blocked' | 'cover_gap' | 'open' | 'unconfirmed'; urgent: boolean; title: string; detail: string; startsIn: string;
    shift: { id: string; facilityName: string; areaName: string | null; role: string; localDate: string; localStart: string; localEnd: string };
  }[];
};
const ATTENTION_SHOWN = 5;
/** A gap in a cover rule (Settings → Cover rules): someone working but nobody holding the credential. */
type CoverGap = { facilityId: string; facilityName: string; typeName: string; localDate: string; localFrom: string; localTo: string; shiftId: string; title: string };

type Shift = {
  id: string; facilityId: string; facilityName: string; areaId: string | null; areaName: string | null; shiftCode: string | null; shiftLetter?: string | null;
  role: string; status: 'open' | 'assigned' | 'booked' | 'cancelled'; localDate: string; localStart: string; localEnd: string; hours: number;
  workerId: string | null; workerName: string | null; assignmentStatus: string | null; notes: string | null; cancelledReason?: string | null;
  equipmentOnly?: boolean; equipment?: { id: string; name: string; typeName: string }[];
  offersPending?: number; pulledOutName?: string | null; duties?: { id: string; name: string }[];
  coveringWorkerId?: string | null; coveringName?: string | null;
};
/** A duty a shift can carry, with what it needs (Settings → Shift duties, migration 0029). */
type Duty = { id: string; name: string; active: boolean; requirements: { typeName: string; severity: 'hard' | 'warning' | 'optional' }[] };
type Person = { id: string; name: string; roles: string[]; employmentType: string | null; contractedHours: number | null; rosteredHours: number };
type Equip = { id: string; name: string; typeName: string; status: string; bookedHours: number };
type Leave = { id: string; workerId: string; status: 'requested' | 'approved'; startsOn: string; endsOn: string };
type Roster = { from: string; to: string; shifts: Shift[]; people: Person[]; equipment?: Equip[]; leave?: Leave[] };
type Facility = { id: string; name: string; active: boolean };
type FacilityDetail = Facility & { areas: { id: string; name: string; active: boolean }[] };
type ShiftCode = { id: string; facilityId: string | null; facilityName: string | null; code: string; name: string | null; letter?: string | null; startTime: string; endTime: string; active: boolean };
type Reason = { code: string; message: string };
type Candidate = { workerId: string; name: string; employmentType: string | null; weekHours: number; eligible: boolean; blocks: Reason[]; warnings: Reason[]; offer?: { id: string; status: string } | null };
type Offer = { id: string; workerId: string; workerName?: string; name?: string; status: string; respondedVia?: string | null };
/** Draft → Live → History per site and week (migration 0022). */
type Week = { facilityId: string; facilityName: string; state: 'draft' | 'live' | 'history'; version: number | null; publishedAt: string | null; publishedByName: string | null; changesSincePublish: number; shifts: number; changeRefusal?: string | null; pendingRequests?: number };
/** A change asked for on a live week, waiting for an owner or admin (migration 0025). */
type ChangeRequest = { id: string; shiftId: string; kind: string; status: string; summary: string; reason: string | null; requestedByName: string | null; createdAt: string; role: string; areaName: string | null; facilityName: string; localDate: string; localStart: string; localEnd: string; canDecide: boolean; canWithdraw: boolean };
type Change = { id: string; kind: string; summary: string; afterPublish: boolean; actorName: string | null; via: string; at: string; shiftId: string; role: string; areaName: string | null; facilityName: string; localDate: string; localStart: string; localEnd: string };
const STATE_LABEL: Record<Week['state'], string> = { draft: 'Draft', live: 'Live', history: 'History' };
const byWhom = (c: Change) => c.via === 'link' ? 'by reply link' : c.actorName ? `by ${c.actorName}` : '';
/** A saved usual week for one site (migration 0023). */
type Template = { id: string; facilityId: string; facilityName: string; name: string; shifts: number; withPeople: number; equipmentBookings?: number; createdByName: string | null };
/** What a shift used, one line per item and holder (`GET /shifts/:id/items?byPerson=true`). */
type ShiftItems = { lines: { itemId: string; name: string; unit: string; quantity: number; costCents: number; chargeCents: number | null; workerId: string | null; workerName: string | null }[]; totalCostCents: number; totalChargeCents: number };
const money = (c: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(c / 100);
type EquipCandidate = { equipmentId: string; name: string; typeName: string; eligible: boolean; blocks: Reason[]; warnings: Reason[] };

const TYPE_SHORT: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual', bank: 'Bank' };
/**
 * The ribbon: Steve's colour for each stage of a shift (26 Oct). Grey unfilled, pale yellow offered,
 * darker yellow allocated (waiting for them), pink accepted (when the business approves first; not used yet),
 * purple the person pulled out, green booked, red cancelled.
 */
function stage(s: Shift, tw: Words): { cls: string; label: string } {
  if (s.status === 'cancelled') return { cls: 'cancelled', label: 'Cancelled' };
  if (s.equipmentOnly) return s.status === 'open' ? { cls: 'unfilled', label: `Needs ${tw.lower(T.equipment)}` } : { cls: 'booked', label: `${tw.one(T.equipment)} booked` };
  if (s.status === 'booked') return { cls: 'booked', label: 'Booked' };
  if (s.status === 'assigned') return { cls: 'allocated', label: 'Allocated' };
  if (s.pulledOutName) return { cls: 'pulled', label: 'Pulled out' };
  if (s.offersPending) return { cls: 'offered', label: `Offered to ${s.offersPending}` };
  return { cls: 'unfilled', label: 'Unfilled' };
}
const dayLabel = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const fullDate = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const monthLabel = (d: string) => new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const longDate = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
/** AM, PM or night, from the local start time, for the colour band on a card. */
function band(s: Shift) {
  const h = Number(s.localStart.slice(0, 2));
  if (h >= 19 || h < 5) return 'nd';
  return h < 12 ? 'am' : 'pm';
}
const LETTER: Record<string, string> = { am: 'A', pm: 'P', nd: 'N' };
/** The business's after-publishing rule (Settings), in the roster's status bar. */
type PublishedChanges = 'open' | 'managers' | 'locked';
const CHANGE_RULE: Record<Exclude<PublishedChanges, 'open'>, string> = { managers: 'only owners and admins can change a live week', locked: 'changes to a live week are turned off' };
/** Height of one lane of bars in the day timeline. */
const LANE_PX = 60;
const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const fmtHours = (n: number) => (Math.round(n * 10) / 10).toString();

export default async function RosterPage({ searchParams }: {
  searchParams: Promise<{ week?: string; date?: string; span?: string; site?: string; view?: string; look?: string; shift?: string; log?: string; error?: string; done?: string }>;
}) {
  const tw = await words();
  const sp = await searchParams;
  // Today and times on screen are in the business's time zone (Settings), never the server's.
  const zone = await businessZone();
  const today = todayIn(zone);
  const when = whenIn(zone);
  // Day, week or month (state in the URL: span = day|month, date = the day or any date in the month; week view keeps `week`).
  const span = parseSpan(sp.span);
  const range = rangeFor(span, anchorOf(sp, today), today);
  const { week, days } = range;
  const view = sp.view === 'person' ? 'person' : 'area';
  // Cards / Detailed / Simple (Steve's design), week view only: the day timeline's bars have a fixed height.
  const look = parseLook(sp.look);
  const cardLook = span === 'week' ? look : 'cards';
  const site = sp.site && /^[0-9a-f-]{36}$/i.test(sp.site) ? sp.site : '';
  const at = (s: Span, anchor: string) => s === 'week' ? { span: undefined, date: undefined, week: anchor } : { span: s, date: anchor, week: undefined };
  const url = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { ...at(span, range.anchor), site, view, look: look === 'cards' ? undefined : look, shift: sp.shift, log: sp.log === '1' ? '1' : undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/roster?${p.toString()}`;
  };
  const here = url({});
  const go = (anchor: string) => url({ ...at(span, anchor), shift: undefined });
  const switchTo = (s: Span) => url({ ...at(s, anchorForSwitch(range, s, today)), shift: s === 'month' ? undefined : sp.shift });

  const showLog = sp.log === '1' && span !== 'month';
  // Needs attention starts closed with its counts showing (David, 29 Oct).
  const full = (await cookies()).get(ROSTER_FULL_COOKIE)?.value === '1';
  const monthWeeks = span === 'month' ? weeksOf(days) : [];
  const [roster, facilities, codes, itemList, weekStates, changes, monthStates, templates, rosterSettings, changeRequests, attention, coverGaps] = await Promise.all([
    api<Roster>(`/roster?from=${range.fetchFrom}&to=${range.fetchTo}&cancelled=true${site ? `&facilityId=${site}` : ''}`),
    api<Facility[]>('/facilities'),
    api<ShiftCode[]>('/shift-codes'),
    api<{ id: string; name: string; category: string; unit: string; tracksStock: boolean; reorderLevel: number | null; onHand: number }[]>('/items').catch(() => []),
    api<Week[]>(`/roster/weeks?weekStart=${week}${site ? `&facilityId=${site}` : ''}`).catch(() => [] as Week[]),
    showLog ? api<Change[]>(`/roster/changes?weekStart=${week}${site ? `&facilityId=${site}` : ''}`).catch(() => [] as Change[]) : Promise.resolve([] as Change[]),
    Promise.all(monthWeeks.map(w => api<Week[]>(`/roster/weeks?weekStart=${w[0]}${site ? `&facilityId=${site}` : ''}`).catch(() => [] as Week[]))),
    span === 'month' ? Promise.resolve([] as Template[]) : api<Template[]>(`/roster/templates${site ? `?facilityId=${site}` : ''}`).catch(() => [] as Template[]),
    businessSettings(),
    span === 'month' ? Promise.resolve([] as ChangeRequest[]) : api<ChangeRequest[]>(`/roster/change-requests?weekStart=${week}${site ? `&facilityId=${site}` : ''}`).catch(() => [] as ChangeRequest[]),
    // Needs attention (backlog item 12): the next seven days from now, whatever period is on screen.
    api<Attention>(`/roster/attention${site ? `?facilityId=${site}` : ''}`).catch(() => null),
    span === 'month' ? Promise.resolve([] as CoverGap[])
      : api<CoverGap[]>(`/roster/cover-gaps?from=${days[0]}&to=${days[days.length - 1]}${site ? `&facilityId=${site}` : ''}`).catch(() => [] as CoverGap[]),
  ]);
  const changeRule: PublishedChanges = rosterSettings.publishedChanges ?? 'open';
  // Sites with shifts this week, or already published, are the ones worth showing a state for.
  const weekRows = weekStates.filter(w => w.shifts > 0 || w.version !== null || site);
  const isHistory = weekStates.length > 0 && weekStates.every(w => w.state === 'history');
  const drafts = weekRows.filter(w => w.state === 'draft');
  const pendingChanges = weekRows.filter(w => w.state === 'live').reduce((a, w) => a + w.changesSincePublish, 0);
  const canPublish = !isHistory && (drafts.length > 0 || pendingChanges > 0);
  const activeFacilities = facilities.filter(f => f.active);
  const details = await Promise.all(activeFacilities.slice(0, 30).map(f => api<FacilityDetail>(`/facilities/${f.id}`)));
  const allShifts = roster.shifts;
  // Day view fetches the whole week (hours against weekly contracts); month view fetches whole weeks around the month.
  const inMonth = (d: string) => d.slice(0, 7) === range.anchor.slice(0, 7);
  const inView = (s: Shift) => span === 'month' ? inMonth(s.localDate) : days.includes(s.localDate);
  // Counts by stage for the bar along the bottom (it doubles as the colour key).
  const stageCounts = new Map<string, number>();
  for (const s of allShifts.filter(inView)) { const c = stage(s, tw).cls; stageCounts.set(c, (stageCounts.get(c) ?? 0) + 1); }
  const cancelled = allShifts.filter(s => s.status === 'cancelled' && inView(s));
  const shifts = allShifts.filter(s => s.status !== 'cancelled' && inView(s));
  const equipment = roster.equipment ?? [];
  const selected = span !== 'month' && sp.shift ? allShifts.find(s => s.id === sp.shift) : undefined;

  // Summary
  const peopleShifts = shifts.filter(s => !s.equipmentOnly);
  const filled = peopleShifts.filter(s => s.status !== 'open').length;
  const open = peopleShifts.length - filled;
  const hours = peopleShifts.filter(s => s.status !== 'open').reduce((a, s) => a + s.hours, 0);
  const equipHours = span === 'week' ? equipment.reduce((a, e) => a + e.bookedHours, 0)
    : shifts.reduce((a, s) => a + s.hours * (s.equipment?.length ?? 0), 0);
  const periodWord = span === 'day' ? 'day' : span === 'month' ? 'month' : 'week';

  // Rows
  type Row = { key: string; label: string; sub?: string; kind: 'person' | 'open' | 'equipment' | 'cancelled'; cells: Shift[][]; leave?: (Leave | null)[]; balance?: { text: string; cls: string } };
  const cellsFor = (pred: (s: Shift) => boolean, list: Shift[]) => days.map(d => list.filter(s => s.localDate === d && pred(s)));
  const personRow = (p: Person, list: Shift[]): Row => {
    const bal = p.contractedHours == null ? null : p.contractedHours - p.rosteredHours;
    return {
      key: p.id, label: p.name, kind: 'person',
      leave: days.map(d => (roster.leave ?? []).find(l => l.workerId === p.id && l.startsOn <= d && l.endsOn >= d) ?? null),
      sub: [p.employmentType ? TYPE_SHORT[p.employmentType] : null, p.roles.join(', ') || null].filter(Boolean).join(' · '),
      cells: cellsFor(s => s.workerId === p.id, list),
      balance: { text: `${fmtHours(p.rosteredHours)}${p.contractedHours != null ? ` / ${fmtHours(p.contractedHours)}` : ''} h`, cls: bal == null ? '' : bal < 0 ? 'over' : bal === 0 ? 'even' : 'under' },
    };
  };
  const openRow = (key: string, list: Shift[]): Row => ({
    key: `open-${key}`, label: `Open ${tw.lower(T.shift, true)}`, kind: 'open', sub: `${list.filter(s => !s.workerId && !s.equipmentOnly).length} to fill`,
    cells: cellsFor(s => !s.workerId && !s.equipmentOnly, list),
  });
  const equipOnlyRow = (key: string, list: Shift[]): Row | null => list.some(s => s.equipmentOnly)
    ? { key: `eq-${key}`, label: `${tw.one(T.equipment)} only`, kind: 'equipment', sub: 'dry hire', cells: cellsFor(s => !!s.equipmentOnly, list) }
    : null;

  const groups: { key: string; title: string; sub?: string; rows: Row[] }[] = [];
  if (view === 'area') {
    const byGroup = new Map<string, Shift[]>();
    for (const s of shifts) {
      const k = `${s.facilityName}|||${s.areaName ?? ''}`;
      byGroup.set(k, [...(byGroup.get(k) ?? []), s]);
    }
    for (const [k, list] of [...byGroup.entries()].sort()) {
      const [fac, area] = k.split('|||');
      const people = roster.people.filter(p => list.some(s => s.workerId === p.id));
      const rows = [...people.map(p => personRow(p, list))];
      if (list.some(s => !s.workerId && !s.equipmentOnly)) rows.push(openRow(k, list));
      const eq = equipOnlyRow(k, list);
      if (eq) rows.push(eq);
      const gone = cancelled.filter(c => `${c.facilityName}|||${c.areaName ?? ''}` === k);
      if (gone.length) rows.push({ key: `x-${k}`, label: 'Cancelled', kind: 'cancelled', sub: `${gone.length} this ${periodWord}`, cells: cellsFor(() => true, gone) });
      groups.push({ key: k, title: fac, sub: area || `No ${tw.lower(T.area)}`, rows });
    }
  } else {
    groups.push({ key: 'people', title: tw.many(T.worker), rows: [...roster.people.map(p => personRow(p, shifts)), openRow('all', shifts),
      ...(cancelled.length ? [{ key: 'x-all', label: 'Cancelled', kind: 'cancelled' as const, sub: `${cancelled.length} this ${periodWord}`, cells: cellsFor(() => true, cancelled) }] : [])] });
  }
  if (equipment.length) {
    groups.push({
      key: 'equipment', title: tw.many(T.equipment), sub: `${fmtHours(equipHours)} hours booked this ${periodWord}`,
      rows: equipment.map(e => ({
        key: e.id, label: e.name, sub: `${e.typeName}${e.status !== 'active' ? ' · out of service' : ''}`, kind: 'equipment' as const,
        cells: cellsFor(s => !!s.equipment?.some(x => x.id === e.id), shifts),
        balance: { text: `${fmtHours(e.bookedHours)} h`, cls: '' },
      })),
    });
  }

  // Selected shift panel data
  // When the after-publishing rule stops this person changing the shift's week, the panel asks for a change instead.
  const panelRefusal = selected ? weekStates.find(w => w.facilityId === selected.facilityId)?.changeRefusal ?? null : null;
  const pendingForShift = selected ? changeRequests.find(r => r.shiftId === selected.id) ?? null : null;
  let candidates: Candidate[] = [];
  let offers: Offer[] = [];
  let equipCandidates: EquipCandidate[] = [];
  let panelError: string | null = null;
  // Duties are needed by the shift panel and the Add shifts form.
  const liveShift = selected && selected.status !== 'cancelled' ? selected : null;
  const [shiftHistory, duties, shiftItems, stockHere] = await Promise.all([
    selected ? api<Change[]>(`/shifts/${selected.id}/history`).catch(() => [] as Change[]) : Promise.resolve([] as Change[]),
    api<Duty[]>('/shift-duties').catch(() => [] as Duty[]),
    // Items on the shift (backlog item 5): what it used, and stock at its site for the item list.
    liveShift ? api<ShiftItems>(`/shifts/${liveShift.id}/items?byPerson=true`).catch(() => null) : Promise.resolve(null),
    liveShift ? api<{ itemId: string; onHand: number }[]>(`/stock?facilityId=${liveShift.facilityId}`).catch(() => []) : Promise.resolve([]),
  ]);
  const itemChoices = liveShift ? shiftItemChoices(itemList, stockHere) : [];
  if (selected && selected.status !== 'cancelled') {
    try {
      const [bank, all, eq] = await Promise.all([
        api<{ candidates: Candidate[]; offers: Offer[] }>(`/shifts/${selected.id}/bank-fill`),
        api<{ candidates: Candidate[] }>(`/shifts/${selected.id}/candidates`),
        api<{ candidates: EquipCandidate[] }>(`/shifts/${selected.id}/equipment-candidates`),
      ]);
      offers = bank.offers;
      const bankIds = new Set(bank.candidates.map(c => c.workerId));
      candidates = all.candidates.map(c => ({ ...c, offer: bank.candidates.find(b => b.workerId === c.workerId)?.offer ?? null, employmentType: c.employmentType }))
        .map(c => ({ ...c, bank: bankIds.has(c.workerId) }));
      equipCandidates = eq.candidates;
    } catch {
      panelError = 'Could not load the details for this shift.';
    }
  }
  // Left-hand strip (Steve's ribbon): everyone, their hours and balance; marked against the selected shift.
  const fitOf = (c?: { eligible: boolean; warnings: Reason[]; blocks: Reason[] }) => !c ? {} : !c.eligible
    ? { fit: 'blocked' as const, fitNote: c.blocks[0]?.message } : c.warnings.length ? { fit: 'warn' as const, fitNote: c.warnings[0].message } : { fit: 'ready' as const };
  const stripPeople: StripPerson[] = roster.people.map(p => ({
    id: p.id, name: p.name, roles: p.roles, role: p.roles[0] ?? 'No role',
    initials: p.name.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase(),
    type: p.employmentType ?? 'none', typeLabel: { full_time: 'F', part_time: 'P', bank: 'B', casual: 'C' }[p.employmentType ?? ''] ?? '–',
    hours: p.rosteredHours, contracted: p.contractedHours,
    ...(selected && !selected.equipmentOnly && !selected.workerId ? fitOf(candidates.find(c => c.workerId === p.id)) : {}),
  }));
  const stripEquip: StripEquip[] = equipment.map(e => ({
    id: e.id, name: e.name, typeName: e.typeName, status: e.status, hours: e.bookedHours,
    ...(selected ? fitOf(equipCandidates.find(c => c.equipmentId === e.id)) : {}),
  }));
  const stripItems: StripItem[] = itemList.map(i => ({
    id: i.id, name: i.name, category: i.category, unit: i.unit, onHand: i.tracksStock ? i.onHand : null,
    low: i.tracksStock && i.reorderLevel != null && i.onHand <= i.reorderLevel,
  }));

  // Shift cards, shared by the week grid and the day timeline (bars).
  const win = dayWindow(span === 'day' ? [...shifts, ...cancelled] : []);
  const cardAttrs = (s: Shift) => ({
    href: url({ shift: s.id }), 'data-shift': s.id,
    'data-needs-person': !s.equipmentOnly && !s.workerId && s.status !== 'cancelled' ? '1' : '0',
    'data-takes-equipment': s.status !== 'cancelled' ? '1' : '0',
    title: s.pulledOutName ? `${s.pulledOutName} pulled out` : `${s.localStart}–${s.localEnd} ${s.role}${s.workerName ? ` · ${s.workerName}` : ''}${s.coveringName ? ` · ${coveringLine(s.coveringName)}` : ''}`,
  });
  const cardBody = (s: Shift, kind: Row['kind']) => cardLook === 'simple' ? (
    <span className={`band ${band(s)}`}><b className="ltr" aria-label={s.shiftLetter ? s.shiftCode ?? s.shiftLetter : band(s) === 'nd' ? 'Night' : band(s) === 'am' ? 'AM' : 'PM'}>{s.shiftLetter ?? LETTER[band(s)]}</b>{simpleLine(s, kind)}<span className="sr-only"> · {stage(s, tw).label}</span></span>
  ) : (<>
    <span className={`band ${band(s)}`}><b className="ltr" aria-label={s.shiftLetter ? s.shiftCode ?? s.shiftLetter : band(s) === 'nd' ? 'Night' : band(s) === 'am' ? 'AM' : 'PM'}>{s.shiftLetter ?? LETTER[band(s)]}</b>{s.localStart}–{s.localEnd}{s.shiftCode ? ` · ${s.shiftCode}` : ''}</span>
    <span className="st">{stage(s, tw).label}</span>
    <span className="ln">{kind === 'person' ? (view === 'person' ? `${s.role} · ${s.facilityName}` : s.role) : kind === 'cancelled' ? `${s.role}${view === 'person' ? ` · ${s.facilityName}` : ''}` : s.workerName ?? s.role}</span>
    {s.coveringName && <span className="cv">{coveringLine(s.coveringName)}</span>}
    {!!s.equipment?.length && <span className="eq">+ {s.equipment.map(e => e.name).join(', ')}</span>}
    {!!s.duties?.length && <span className="dt">{s.duties.map(d => d.name).join(' · ')}</span>}
    {cardLook === 'detailed' && detailLines(s, kind, view).map((l, i) => <span key={i} className="dl">{l}</span>)}
  </>);

  const bankReady = candidates.filter(c => c.eligible && ['bank', 'casual'].includes(c.employmentType ?? '') && !c.offer);
  const pendingOffers = offers.filter(o => o.status === 'pending');
  const declinedOffers = offers.filter(o => o.status === 'declined');

  // Items used on the shift or given to the person on it (backlog item 5). Not a shift change, so shown on live weeks too.
  const itemsSection = liveShift && (itemChoices.length > 0 || !!shiftItems?.lines.length) ? (
    <section className="shift-items">
      <h3>{tw.many(T.item)}</h3>
      {shiftItems?.lines.map(l => (
        <div key={`${l.itemId}:${l.workerId ?? ''}`} className="panel-row">
          <span>
            {l.quantity} × {l.name} <span className="muted">({l.unit}) · {l.workerName ? `with ${l.workerName}` : `used on the ${tw.lower(T.shift)}`} · {money(l.costCents)}{l.chargeCents !== null ? `, charge ${money(l.chargeCents)}` : ''}</span>
          </span>
          {l.quantity > 0 && (
            <form action={returnItem.bind(null, liveShift.id, l.itemId, l.workerId)} className="inline-form">
              <input type="hidden" name="back" value={here} />
              <input name="quantity" type="number" min="0.001" step="0.001" max={l.quantity} defaultValue={l.quantity} aria-label={`How many ${l.name} came back`} style={{ width: 64 }} />
              <button className="btn small secondary">Return</button>
            </form>
          )}
        </div>
      ))}
      {!!shiftItems?.lines.length && (
        <p className="muted small" style={{ margin: '4px 0 8px' }}>
          Cost {money(shiftItems.totalCostCents)}{shiftItems.totalChargeCents ? ` · charge to the client ${money(shiftItems.totalChargeCents)}` : ''}
        </p>
      )}
      {itemChoices.length > 0 && (
        <form action={useItem.bind(null, liveShift.id, liveShift.workerId)} className="use-item">
          <input type="hidden" name="back" value={here} />
          <label>{tw.one(T.item)}
            <select name="itemId" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {itemChoices.map(c => <option key={c.id} value={c.id} disabled={c.disabled}>{c.label}</option>)}
            </select>
          </label>
          <label>How many<input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" required style={{ width: 80 }} /></label>
          {liveShift.workerId && !liveShift.equipmentOnly && (
            <label className="inline"><input type="checkbox" name="toPerson" defaultChecked /> Give to {liveShift.workerName}</label>
          )}
          <button className="btn small secondary">Add to {tw.lower(T.shift)}</button>
          <p className="muted small" style={{ margin: 0 }}>Stock comes from {liveShift.facilityName}.</p>
        </form>
      )}
    </section>
  ) : null;

  // Everything above the roster itself: on the normal page it sits on top; on the full page view it folds
  // into one full-width section that drops down when clicked (David, 29 Oct).
  const info = (
    <>
    <section className="roster-kpis" aria-label={`Summary for the ${periodWord}`}>
      <div><span>{tw.many(T.shift)}</span><strong>{peopleShifts.length}</strong></div>
      <div><span>Filled</span><strong className="ok">{filled}</strong></div>
      <div><span>Open</span><strong className={open ? 'warn' : ''}>{open}</strong></div>
      <div><span>Hours rostered</span><strong>{fmtHours(hours)}</strong></div>
      <div><span>{tw.one(T.equipment)} hours</span><strong>{fmtHours(equipHours)}</strong></div>
    </section>

    {changeRequests.length > 0 && (
      <section className="card roster-requests" aria-label="Changes waiting for approval">
        <h2 style={{ marginTop: 0 }}>{changeRequests.length === 1 ? '1 change waiting for approval' : `${changeRequests.length} changes waiting for approval`}</h2>
        <ol>
          {changeRequests.map(r => (
            <li key={r.id}>
              <span>
                <Link href={url({ shift: r.shiftId })}>{longDate(r.localDate)} {r.localStart}–{r.localEnd} {r.role}</Link>
                {!site && <span className="muted"> · {r.facilityName}</span>}: <strong>{r.summary}</strong>
                {r.reason && r.kind !== 'other' && r.kind !== 'cancel' && <span className="muted"> ({r.reason})</span>}
                <span className="muted small"> asked by {r.requestedByName ?? 'someone'}, {when(r.createdAt)}</span>
              </span>
              <span className="req-actions">
                {r.canDecide && <>
                  <form action={decideChange.bind(null, r.id, 'approve')}><input type="hidden" name="back" value={here} /><button className="btn small">Approve</button></form>
                  <form action={decideChange.bind(null, r.id, 'decline')} className="decline">
                    <input type="hidden" name="back" value={here} />
                    <input name="note" maxLength={300} placeholder="Why not (optional)" aria-label="Why not (optional)" />
                    <button className="btn small secondary">Decline</button>
                  </form>
                </>}
                {r.canWithdraw && !r.canDecide && (
                  <form action={decideChange.bind(null, r.id, 'withdraw')}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Withdraw</button></form>
                )}
                {!r.canDecide && !r.canWithdraw && <span className="muted small">Waiting for an owner or admin</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    )}

    {/* Three panels side by side, closed when the page opens, so the roster itself is near the top (David, 29 Oct).
        Opening one gives it the full width. */}
    <div className="roster-trio">
    {attention && attention.total > 0 ? (() => {
      return (
      <AttentionPanel open={false} summary={<>
          <h2>Needs attention</h2>
          <span className="muted">
            {' '}{attention.total} in the next {attention.days} days
            {attention.urgent > 0 && <> · <strong className="bad">{attention.urgent} within a day</strong></>}
          </span>
          <span className="att-toggle muted small" aria-hidden="true" />
        </>}>
        {(() => {
          // Five at first so the roster stays in view; the rest open underneath (David, 29 Oct).
          const row = (i: (typeof attention.items)[number]) => (
          <li key={`${i.shiftId}:${i.kind}:${i.title}`} className={i.urgent ? 'urgent' : undefined}>
            <span className={`att-kind ${i.kind}`} aria-hidden="true" />
            <span>
              <strong>{i.title}</strong> <span className="muted">· {i.detail}</span>
              <br />
              {/* Opens the shift in its own day or week in a new tab, scrolled to its panel, so the office can work
                  through several and close each tab when done (David, 29 Oct). */}
              <Link href={`${url({ ...at(span === 'day' ? 'day' : 'week', span === 'day' ? i.shift.localDate : mondayOf(i.shift.localDate)), shift: i.shiftId })}#shift-panel`}
                target="_blank" rel="noopener" title="Opens in a new tab">
                {longDate(i.shift.localDate)} {i.shift.localStart}–{i.shift.localEnd} {i.shift.role}
              </Link>
              {!site && <span className="muted"> · {i.shift.facilityName}</span>}
              {i.shift.areaName && <span className="muted"> · {i.shift.areaName}</span>}
              <span className={i.urgent ? 'bad small' : 'muted small'}> · {i.startsIn}</span>
            </span>
          </li>
          );
          const rest = attention.items.slice(ATTENTION_SHOWN);
          return <>
            <ol>{attention.items.slice(0, ATTENTION_SHOWN).map(row)}</ol>
            {rest.length > 0 && (
              <details className="att-more">
                <summary>Show {rest.length} more</summary>
                <ol>{rest.map(row)}</ol>
              </details>
            )}
          </>;
        })()}
        {attention.truncated && <p className="muted small">Only the first few hundred {tw.lower(T.shift, true)} were checked. Choose a {tw.lower(T.site)} to see the rest.</p>}
      </AttentionPanel>
      );
    })() : (
      <section className="card roster-attention quiet" aria-label="Needs attention"><h2>Needs attention</h2> <span className="muted">Nothing in the next 7 days.</span></section>
    )}
    <details className="card roster-add" open={shifts.length === 0}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add {tw.lower(T.shift, true)}</summary>
      {activeFacilities.length === 0 ? (
        <p className="muted">Add a {tw.lower(T.site)} first, under <Link href="/facilities">{tw.many(T.site)}</Link>.</p>
      ) : (
        <form action={createShifts} className="form-row" style={{ marginTop: 12 }}>
          <input type="hidden" name="back" value={here} />
          <label>{tw.one(T.site)}
            <select name="facilityId" required defaultValue={site || activeFacilities[0]?.id}>
              {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <label>{tw.one(T.area)} <span className="muted">(optional)</span>
            <select name="areaId" defaultValue="">
              <option value="">No {tw.lower(T.area)}</option>
              {details.flatMap(d => d.areas.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{d.name} · {a.name}</option>))}
            </select>
          </label>
          <label>{tw.one(T.role)}
            <input name="role" placeholder="e.g. Barista" maxLength={60} list="known-roles" />
            <datalist id="known-roles">
              {[...new Set(roster.people.flatMap(p => p.roles))].sort().map(r => <option key={r} value={r} />)}
            </datalist>
          </label>
          <label>Shift type <Link href="/settings/shift-types" className="muted small">(change types)</Link>
            <select name="shiftCodeId" defaultValue="">
              <option value="">Times below</option>
              {codes.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.letter ? `${c.letter} · ` : ''}{c.name ?? c.code} {c.startTime}–{c.endTime}{c.facilityName ? ` (${c.facilityName})` : ''}</option>)}
            </select>
          </label>
          <label>Start<input name="startTime" type="time" /></label>
          <label>End<input name="endTime" type="time" /></label>
          <label>From<input name="startDate" type="date" required defaultValue={span === 'month' ? range.anchor : days[0]} /></label>
          <label>Until <span className="muted">(for a block)</span><input name="endDate" type="date" /></label>
          <fieldset className="weekdays">
            <legend>Days (for a block)</legend>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
              <label key={d} className="inline"><input type="checkbox" name="weekdays" value={i + 1} />{d}</label>
            ))}
          </fieldset>
          <label style={{ flex: '0 1 110px' }}>People<input name="quantity" type="number" min={1} max={20} defaultValue={1} /></label>
          <label className="inline" style={{ flex: '0 1 auto' }}><input type="checkbox" name="equipmentOnly" />{tw.one(T.equipment)} only</label>
          {duties.some(d => d.active) && (
            <fieldset className="weekdays">
              <legend>Duties <Link href="/settings/shift-duties" className="muted small">(change duties)</Link></legend>
              {duties.filter(d => d.active).map(d => (
                <label key={d.id} className="inline" title={d.requirements.some(r => r.severity !== 'optional') ? `Needs ${d.requirements.filter(r => r.severity !== 'optional').map(r => r.typeName).join(', ')}` : undefined}>
                  <input type="checkbox" name="dutyIds" value={d.id} />{d.name}
                </label>
              ))}
            </fieldset>
          )}
          <button type="submit" className="btn">Add</button>
        </form>
      )}
    </details>
    {span !== 'month' && !isHistory && activeFacilities.length > 0 && (
      <details className="card roster-templates">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Templates and copying</summary>
        <p className="muted small">Save a {tw.lower(T.site)}&apos;s usual week as a template, then fill any week from it, or copy last week. Each {tw.lower(T.shift)} gets its usual person where they can work it (waiting for them to confirm) and its usual {tw.lower(T.equipment)} where it can be booked; anything that can&apos;t is left off and you&apos;re told why.</p>
        <div className="template-forms">
          <form action={copyWeek} className="form-row">
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="week" value={week} />
            <h3>Copy a week into this one</h3>
            <label>{tw.one(T.site)}
              <select name="facilityId" required defaultValue={site || activeFacilities[0]?.id}>
                {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label>Copy from the week of<input name="fromWeek" type="date" defaultValue={addDaysIso(week, -7)} /></label>
            <label className="inline"><input type="checkbox" name="people" defaultChecked />With the same people</label>
            <label className="inline"><input type="checkbox" name="equipment" defaultChecked />With the same {tw.lower(T.equipment)}</label>
            <label className="inline"><input type="checkbox" name="addToExisting" />Add to the {tw.lower(T.shift, true)} already there</label>
            <button className="btn small">Copy week</button>
          </form>
          <form action={applyTemplate} className="form-row">
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="week" value={week} />
            <h3>Fill this week from a template</h3>
            {templates.length === 0 ? <p className="muted small">No templates yet. Save a week below.</p> : <>
              <label>Template
                <select name="templateId" required>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}{!site ? ` (${t.facilityName})` : ''} · {tw.count(t.shifts, T.shift)}</option>)}
                </select>
              </label>
              <label className="inline"><input type="checkbox" name="people" defaultChecked />With the usual people</label>
              <label className="inline"><input type="checkbox" name="equipment" defaultChecked />With the usual {tw.lower(T.equipment)}</label>
              <label className="inline"><input type="checkbox" name="addToExisting" />Add to the {tw.lower(T.shift, true)} already there</label>
              <button className="btn small">Fill week</button>
            </>}
          </form>
          <form action={saveTemplate} className="form-row">
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="week" value={week} />
            <h3>Save this week as a template</h3>
            <label>{tw.one(T.site)}
              <select name="facilityId" required defaultValue={site || activeFacilities[0]?.id}>
                {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label>Name<input name="name" required maxLength={80} placeholder="e.g. Usual week" /></label>
            <label className="inline"><input type="checkbox" name="people" defaultChecked />Remember who works each {tw.lower(T.shift)}</label>
            <label className="inline"><input type="checkbox" name="equipment" defaultChecked />Remember the {tw.lower(T.equipment)} on each {tw.lower(T.shift)}</label>
            <button className="btn small secondary">Save template</button>
          </form>
        </div>
        {templates.length > 0 && (
          <ul className="template-list">
            {templates.map(t => (
              <li key={t.id}>
                <span><strong>{t.name}</strong> <span className="muted">{t.facilityName} · {tw.count(t.shifts, T.shift)}{t.withPeople ? `, ${t.withPeople} with a usual person` : ''}{t.equipmentBookings ? `, ${t.equipmentBookings} ${tw.lower(T.equipment)} ${t.equipmentBookings === 1 ? 'booking' : 'bookings'}` : ''}{t.createdByName ? ` · saved by ${t.createdByName}` : ''}</span></span>
                <form action={archiveTemplate}>
                  <input type="hidden" name="back" value={here} />
                  <input type="hidden" name="templateId" value={t.id} />
                  <button className="btn small secondary" title="Hides the template. Weeks already filled from it don't change.">Put away</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </details>
    )}
    </div>

    {coverGaps.length > 0 && (
      <details className="card roster-cover" aria-label="Cover gaps">
        <summary>
          <strong>{coverGaps.length === 1 ? '1 cover gap' : `${coverGaps.length} cover gaps`} this {periodWord}</strong>
          {' '}<Link href="/settings/cover-rules" className="muted small">(cover rules)</Link>
        </summary>
        <ol>
          {coverGaps.map(g => (
            <li key={`${g.facilityId}:${g.typeName}:${g.localDate}:${g.localFrom}`}>
              <Link href={url({ shift: g.shiftId })}>{longDate(g.localDate)}</Link>{' '}
              <strong>{g.title}</strong>
              {!site && <span className="muted"> · {g.facilityName}</span>}
            </li>
          ))}
        </ol>
      </details>
    )}

    {showLog && (
      <section className="card roster-log" aria-label="Changes this week">
        <h2 style={{ marginTop: 0 }}>Changes this week</h2>
        {changes.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
          <ol>
            {changes.slice(0, 200).map(c => (
              <li key={c.id}>
                <span className="muted small">{when(c.at)}</span>
                <span>
                  <Link href={url({ shift: c.shiftId })}>{longDate(c.localDate)} {c.localStart}–{c.localEnd} {c.role}</Link>
                  {!site && <span className="muted"> · {c.facilityName}</span>}: {c.summary}
                  <span className="muted"> {byWhom(c)}</span>
                  {c.afterPublish && <b className="pill live small">after publishing</b>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    )}


    {process.env.DEMO_TOOLS === 'on' && shifts.length === 0 && roster.people.length === 0 && (
      <form action={loadDemoWeek} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="hidden" name="back" value={here} />
        <input type="hidden" name="week" value={week} />
        <span>This business is empty. Load <strong>The Grand Café</strong>, an invented demo: 32 staff in 15 roles, their certificates (a few expired or missing on purpose), equipment, stock and a week of shifts. It takes about a minute.</span>
        <button className="btn small">Load café demo</button>
      </form>
    )}

    {process.env.DEMO_TOOLS === 'on' && open > 0 && span !== 'month' && (
      <form action={fillWeekDemo} className="roster-tools" style={{ justifyContent: 'flex-end' }}>
        <input type="hidden" name="back" value={here} />
        <input type="hidden" name="week" value={week} />
        <span className="muted small">Demo only:</span>
        <button className="btn small secondary">Fill open shifts with demo staff</button>
      </form>
    )}
    </>
  );

  return (
    <div className={`roster-page${full ? ' full' : ''}`}>
      {/* Toolbar in one row (David, 29 Oct, after looking at Deputy): what you're looking at on the left,
          how you look at it in one View menu, the period in the middle. */}
      <div className="roster-head">
        <div className="roster-title">
          <h1>{tw.one(T.roster)}</h1>
        </div>
        {/* Draft / live status and Publish on the same line as the title and toolbar (David, 29 Oct). */}
        {span !== 'month' && <div className="roster-state" aria-label="Roster status">
          {span === 'day' && <span className="muted small">Week of {longDate(week)}:</span>}
          <div className="states">
            {isHistory ? (
              <span><b className="pill history">History</b> <span className="muted">This week is over. It stays as a record and can&apos;t be published.</span></span>
            ) : weekRows.length === 0 ? (
              <span><b className="pill draft">Draft</b> <span className="muted">Nothing on this week yet.</span></span>
            ) : weekRows.map(w => (
              <span key={w.facilityId}>
                <b className={`pill ${w.state}`}>{STATE_LABEL[w.state]}</b>
                {weekRows.length > 1 || !site ? <> {w.facilityName}</> : null}
                <span className="muted">
                    {w.state === 'live' && ` · published ${w.publishedAt ? when(w.publishedAt) : ''}${w.publishedByName ? ` by ${w.publishedByName}` : ''}`}
                  {w.state === 'live' && w.changesSincePublish > 0 && <> · <strong className="warn">{w.changesSincePublish} {w.changesSincePublish === 1 ? 'change' : 'changes'} since</strong></>}
                </span>
              </span>
            ))}
            {changeRule !== 'open' && weekRows.some(w => w.state === 'live') && (
              <span className="muted small">After publishing: {CHANGE_RULE[changeRule]} (Settings).</span>
            )}
          </div>
          <div className="roster-tools">
            <Link className="btn small secondary" href={url({ log: showLog ? undefined : '1' })}>{showLog ? 'Hide changes' : 'Changes'}</Link>
            {canPublish && (
              <form action={publishWeek} style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
                <input type="hidden" name="back" value={here} />
                <input type="hidden" name="week" value={week} />
                <input type="hidden" name="site" value={site} />
                <label className="inline small" title="Email and text each person their shifts for the week (after changes: only the people affected)"><input type="checkbox" name="notify" defaultChecked />Tell {tw.lower(T.worker, true)}</label>
                <button className="btn small" title="Marks the week as live. Changes after this are logged.">
                  {drafts.length ? 'Publish week' : `Publish ${pendingChanges} ${pendingChanges === 1 ? 'change' : 'changes'}`}
                </button>
              </form>
            )}
          </div>
        </div>}
        <div className="roster-toolbar">
          <form method="get" action="/roster" className="tool-site">
            {Object.entries(at(span, range.anchor)).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
            <input type="hidden" name="view" value={view} />
            {look !== 'cards' && <input type="hidden" name="look" value={look} />}
            <span className="tool-icon" aria-hidden="true">⌖</span>
            <SiteSelect name="site" value={site} allLabel={`All ${tw.lower(T.site, true)}`} options={activeFacilities.map(f => ({ id: f.id, name: f.name }))} />
            <noscript><button type="submit" className="btn small secondary">Show</button></noscript>
          </form>
          <div className="tool-period" role="group" aria-label={`Choose the ${periodWord}`}>
            <Link href={go(range.prev)} aria-label={`Previous ${periodWord}`}>‹</Link>
            {/* The period on screen; pressing it goes back to the current one. */}
            <Link href={go(range.current)} title={range.currentLabel} className="tool-period-label">
              {span === 'day' ? fullDate(range.anchor) : span === 'month' ? monthLabel(range.anchor) : <>{longDate(days[0])} – {longDate(days[6])}</>}
            </Link>
            <Link href={go(range.next)} aria-label={`Next ${periodWord}`}>›</Link>
          </div>
          <details className="tool-menu">
            <summary>
              View: {span !== 'month' && <>{view === 'area' ? `By ${tw.lower(T.area)}` : `By ${tw.lower(T.worker)}`} · </>}
              {span === 'day' ? 'Day' : span === 'week' ? 'Week' : 'Month'}
              {span === 'week' && look !== 'cards' && <> · {LOOKS.find(l => l.id === look)?.label}</>}
            </summary>
            <div className="tool-menu-body">
              <div className="tool-menu-title">Period</div>
              {(['day', 'week', 'month'] as const).map(s2 => (
                <Link key={s2} href={switchTo(s2)} aria-current={span === s2 ? 'true' : undefined}>{s2 === 'day' ? 'Day' : s2 === 'week' ? 'Week' : 'Month'}</Link>
              ))}
              {span !== 'month' && <>
                <div className="tool-menu-title">Rows</div>
                <Link href={url({ view: 'area' })} aria-current={view === 'area' ? 'true' : undefined}>By {tw.lower(T.area)}</Link>
                <Link href={url({ view: 'person' })} aria-current={view === 'person' ? 'true' : undefined}>By {tw.lower(T.worker)}</Link>
              </>}
              {span === 'week' && <>
                <div className="tool-menu-title">{tw.many(T.shift)} show</div>
                {LOOKS.map(l => <Link key={l.id} href={url({ look: l.id === 'cards' ? undefined : l.id })} aria-current={look === l.id ? 'true' : undefined}>{l.label}</Link>)}
              </>}
            </div>
          </details>
          <form action={setFullView.bind(null, !full)} className="tool-full">
            <input type="hidden" name="back" value={here} />
            <button className="btn small secondary" title={full ? 'Show the menu and the boxes above the roster again' : 'Hide the menu and fold the boxes above the roster away, for the biggest working space'}>
              {full ? '⤡ Exit full page' : '⤢ Full page'}
            </button>
          </form>
        </div>
      </div>

      <Notices error={sp.error} done={sp.done} />


      {full ? (
        <details className="card roster-info">
          <summary>
            <strong>Summary, alerts and tools</strong>
            <span className="muted"> · {peopleShifts.length} {tw.lower(T.shift, peopleShifts.length !== 1)} · {open} open</span>
            {attention && attention.total > 0 && <span className="muted"> · {attention.total} need attention</span>}
            {attention && attention.urgent > 0 && <strong className="bad"> · {attention.urgent} within a day</strong>}
          </summary>
          {info}
        </details>
      ) : info}

      {span === 'month' && (
        <section className="card roster-month" aria-label={monthLabel(range.anchor)}>
          <table className="month-grid">
            <thead>
              <tr><th className="wk">Week</th>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <th key={d}>{d}</th>)}</tr>
            </thead>
            <tbody>
              {monthWeeks.map((w, i) => {
                const st = weekStateLabel(monthStates[i] ?? []);
                return (
                  <tr key={w[0]}>
                    <th className="wk" scope="row">
                      <Link href={url({ ...at('week', w[0]), shift: undefined })}>{longDate(w[0])}</Link>
                      {st && <b className={`pill ${st.cls} small`}>{st.text}</b>}
                    </th>
                    {w.map(d => {
                      const sum = daySummary(d, allShifts, roster.leave ?? []);
                      return (
                        <td key={d} className={[inMonth(d) ? '' : 'other', d === today ? 'today' : '', sum.open ? 'has-open' : ''].join(' ').trim() || undefined}>
                          <Link href={url({ ...at('day', d), shift: undefined })} className="mday" aria-label={`${fullDate(d)}: ${sum.shifts ? `${sum.filled} of ${tw.count(sum.shifts, T.shift)} filled` : `no ${tw.lower(T.shift, true)}`}`}>
                            <span className="dnum">{Number(d.slice(8))}</span>
                            {sum.shifts ? (<>
                              <span className={sum.open ? 'warn' : 'ok'}>{sum.filled} of {sum.shifts} filled</span>
                              <span>{fmtHours(sum.hours)} h</span>
                              {sum.open > 0 && <strong className="warn">{sum.open} open</strong>}
                            </>) : <span className="muted">No {tw.lower(T.shift, true)}</span>}
                            {sum.onLeave > 0 && <span className="muted">{sum.onLeave} on leave</span>}
                            {sum.cancelled > 0 && <span className="muted">{sum.cancelled} cancelled</span>}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small" style={{ margin: '8px 0 0' }}>Choose a day to see it hour by hour, or a week to change it.</p>
        </section>
      )}

      {span === 'month' && activeFacilities.length > 0 && (() => {
        const { mondays, nextWeek } = monthCopyWeeks(range.anchor);
        const last = mondays[mondays.length - 1];
        return (
          <details className="card roster-templates">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Copy this month</summary>
            <p className="muted small">
              Copies the {mondays.length} weeks starting in {monthLabel(range.anchor)} ({longDate(mondays[0])} to {longDate(last)}) into the {mondays.length} weeks
              from the date you choose, on the same weekdays and times. As with copying a week, each {tw.lower(T.shift)} gets the same person where they can work it
              (waiting for them to confirm) and the same {tw.lower(T.equipment)} where it can be booked; anything that can&apos;t is left off and you&apos;re told why.
              Nothing is copied if any of those weeks is over or already has {tw.lower(T.shift, true)}, unless you tick &quot;Add to the {tw.lower(T.shift, true)} already there&quot;.
            </p>
            <form action={copyMonth} className="form-row">
              <input type="hidden" name="back" value={here} />
              <input type="hidden" name="fromWeek" value={mondays[0]} />
              <input type="hidden" name="weeks" value={mondays.length} />
              <label>{tw.one(T.site)}
                <select name="facilityId" required defaultValue={site || activeFacilities[0]?.id}>
                  {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label>Into the weeks starting<input name="toWeek" type="date" required defaultValue={nextWeek} /></label>
              <label className="inline"><input type="checkbox" name="people" defaultChecked />With the same people</label>
              <label className="inline"><input type="checkbox" name="equipment" defaultChecked />With the same {tw.lower(T.equipment)}</label>
              <label className="inline"><input type="checkbox" name="addToExisting" />Add to the {tw.lower(T.shift, true)} already there</label>
              <button className="btn small">Copy {mondays.length} weeks</button>
            </form>
          </details>
        );
      })()}

      {span !== 'month' && (
      <div className="roster-layout">
        <RibbonStrip people={stripPeople} equipment={stripEquip} items={stripItems} selectedShift={selected?.id ?? null} canDrag
          labels={{ people: tw.many(T.worker), person: tw.one(T.worker), equipment: tw.many(T.equipment), items: tw.many(T.item), role: tw.one(T.role), roles: tw.many(T.role), shift: tw.one(T.shift), sites: tw.many(T.site) }} />
        <DropZone back={here}>
          <table className={`ribbon ${span === 'day' ? 'day' : ''} look-${cardLook}`}>
            <thead>
              <tr>
                <th className="who">{view === 'area' ? `${tw.one(T.site)} · ${tw.lower(T.area)} · ${tw.lower(T.worker)}` : tw.one(T.worker)}</th>
                {days.map(d => {
                  const ds = peopleShifts.filter(s => s.localDate === d);
                  const f = ds.filter(s => s.status !== 'open').length;
                  const count = <small className={ds.length && f < ds.length ? 'warn' : 'ok'}>{ds.length ? `${f} of ${ds.length}` : '—'}</small>;
                  return span === 'day' ? (
                    <th key={d} className="tl-head">
                      <div className="tl-ticks" aria-hidden="true">
                        {win.ticks.map(t => <span key={t} style={{ left: `${((t - win.from) / (win.to - win.from)) * 100}%` }}>{tickLabel(t)}</span>)}
                      </div>
                    </th>
                  ) : (
                    <th key={d} className={d === today ? 'today' : ''}>
                      <Link href={url({ ...at('day', d), shift: undefined })} className="daylink" title="See this day hour by hour"><span>{dayLabel(d)}</span></Link>
                      {count}
                    </th>
                  );
                })}
                <th className="bal">{span === 'day' ? 'Week hours' : 'Hours'}</th>
              </tr>
            </thead>
            {groups.length === 0 && (
              <tbody><tr><td colSpan={days.length + 2} className="muted" style={{ padding: 24 }}>No {tw.lower(T.shift, true)} this {periodWord}. Use <strong>Add {tw.lower(T.shift, true)}</strong> above.</td></tr></tbody>
            )}
            {groups.map(g => (
              <tbody key={g.key}>
                <tr className="group"><th colSpan={days.length + 2}>{g.title}{g.sub && <span className="muted"> · {g.sub}</span>}</th></tr>
                {g.rows.map(r => (
                  <tr key={r.key} className={`row-${r.kind}`}>
                    <th className="who" scope="row">
                      <span className="name">{r.label}</span>
                      {r.sub && <span className="sub">{r.sub}</span>}
                    </th>
                    {r.cells.map((cell, i) => {
                      const leaveLine = r.leave?.[i] && (
                        <span className={`leave-line ${r.leave[i]!.status}`}>{r.leave[i]!.status === 'approved' ? 'On leave' : 'Leave requested'}</span>
                      );
                      if (span === 'day') {
                        const ln = lanes(cell);
                        return (
                          <td key={i} className="tl">
                            {leaveLine}
                            <div className="tl-track" style={{ height: ln.count * LANE_PX }}>
                              {win.ticks.map(t => <i key={t} className="tl-tick" style={{ left: `${((t - win.from) / (win.to - win.from)) * 100}%` }} />)}
                              {cell.map(s => {
                                const pos = barPosition(s, win);
                                return (
                                  <Link key={s.id} {...cardAttrs(s)} className={`rcard bar ${stage(s, tw).cls} ${selected?.id === s.id ? 'sel' : ''}`}
                                    style={{ left: `${pos.left}%`, width: `${pos.width}%`, top: (ln.lane.get(s.id) ?? 0) * LANE_PX }}>
                                    {cardBody(s, r.kind)}
                                  </Link>
                                );
                              })}
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td key={i} className={days[i] === today ? 'today' : ''}>
                          {leaveLine}
                          {cell.map(s => (
                            <Link key={s.id} {...cardAttrs(s)} className={`rcard ${stage(s, tw).cls} ${selected?.id === s.id ? 'sel' : ''}`}>
                              {cardBody(s, r.kind)}
                            </Link>
                          ))}
                        </td>
                      );
                    })}
                    <td className={`bal ${r.balance?.cls ?? ''}`}>{r.balance?.text ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            {shifts.length > 0 && (
              <tfoot>
                <tr className="totals">
                  <th className="who" scope="row">{span === 'day' ? 'Day total' : 'Day totals'}</th>
                  {days.map(d => {
                    const ds = peopleShifts.filter(s => s.localDate === d);
                    const h = ds.filter(s => s.status !== 'open').reduce((a, s) => a + s.hours, 0);
                    return <td key={d} className={d === today && span === 'week' ? 'today' : ''}><strong>{fmtHours(h)} h</strong><small>{ds.filter(s => s.status !== 'open').length} of {ds.length} filled</small></td>;
                  })}
                  <td className="bal"><strong>{fmtHours(hours)} h</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </DropZone>

        {selected && (
          <aside id="shift-panel" className="roster-panel card" aria-label="Selected shift">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <h2 style={{ margin: 0 }}>{selected.role}</h2>
              <Link href={url({ shift: undefined })} className="muted" aria-label="Close">Close</Link>
            </div>
            <p style={{ margin: '4px 0 8px' }}>
              <strong>{longDate(selected.localDate)} · {selected.localStart}–{selected.localEnd}</strong><br />
              <span className="muted">{selected.facilityName}{selected.areaName ? ` · ${selected.areaName}` : ''} · {fmtHours(selected.hours)} h</span>
            </p>
            {panelError && <div className="notice error">{panelError}</div>}
            {selected.status === 'cancelled' ? (
              <section><h3>Cancelled</h3><p style={{ margin: 0 }}>{selected.cancelledReason || 'No reason recorded.'}</p></section>
            ) : panelRefusal ? (<>
              <section>
                {selected.workerName && <p style={{ margin: '0 0 8px' }}><strong>{selected.workerName}</strong> <span className="muted">· {selected.status === 'booked' ? 'booked' : 'waiting to confirm'}</span></p>}
                {(selected.equipment ?? []).length > 0 && <p className="muted" style={{ margin: '0 0 8px' }}>{tw.one(T.equipment)}: {(selected.equipment ?? []).map(e => e.name).join(', ')}</p>}
                <p className="notice" style={{ margin: '0 0 8px' }}>{panelRefusal}</p>
                {pendingForShift ? (
                  <p style={{ margin: 0 }}>Waiting for approval: <strong>{pendingForShift.summary}</strong> <span className="muted small">(asked by {pendingForShift.requestedByName ?? 'someone'})</span></p>
                ) : (
                  <form action={requestChange.bind(null, selected.id)} className="request-change">
                    <input type="hidden" name="back" value={here} />
                    <h3 style={{ marginTop: 0 }}>Ask for a change</h3>
                    <label>Change
                      <select name="change" defaultValue={selected.status === 'assigned' ? 'confirm' : selected.workerId ? 'remove' : selected.equipmentOnly ? 'other' : 'assign'}>
                        {!selected.workerId && !selected.equipmentOnly && <option value="assign">Put someone on it</option>}
                        {selected.workerId && selected.status === 'assigned' && <option value="confirm">{selected.workerName} has agreed (confirm)</option>}
                        {selected.workerId && <option value="remove">Take {selected.workerName} off</option>}
                        {selected.workerId && <option value="pulled_out">{selected.workerName} pulled out</option>}
                        <option value="cancel">Cancel the {tw.lower(T.shift)}</option>
                        <option value="other">Something else (say what)</option>
                      </select>
                    </label>
                    {!selected.workerId && !selected.equipmentOnly && (
                      <label>Person (if putting someone on)
                        <select name="workerId" defaultValue="">
                          <option value="">Choose…</option>
                          {candidates.filter(c => c.eligible).map(c => <option key={c.workerId} value={c.workerId}>{c.name} · {fmtHours(c.weekHours)} h this week</option>)}
                        </select>
                      </label>
                    )}
                    <label>Reason<input name="reason" maxLength={300} placeholder="Needed to cancel or for something else" /></label>
                    <button className="btn small">Send for approval</button>
                  </form>
                )}
              </section>
              {itemsSection}
            </>) : (<>

            {!selected.equipmentOnly && (
              <section>
                <h3>Person</h3>
                {selected.workerId ? (
                  <div className="panel-row">
                    <span><strong>{selected.workerName}</strong> <span className="muted">· {selected.status === 'booked' ? 'booked' : 'waiting to confirm'}</span></span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {selected.status === 'assigned' && (
                        <form action={confirm.bind(null, selected.id)}><input type="hidden" name="back" value={here} /><button className="btn small">Confirm</button></form>
                      )}
                      <form action={unassign.bind(null, selected.id)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Remove</button></form>
                      <form action={unassign.bind(null, selected.id)}><input type="hidden" name="back" value={here} /><input type="hidden" name="pulledOut" value="1" /><button className="btn small secondary" title="They can't do it: the shift shows purple until it's filled again">They pulled out</button></form>
                    </span>
                  </div>
                ) : (
                  <>
                    {selected.pulledOutName && <p className="notice error" style={{ margin: '0 0 8px' }}>{selected.pulledOutName} pulled out. Fill it again below.</p>}
                    {pendingOffers.length > 0 && (
                      <div className="offers">
                        <p className="muted" style={{ margin: '0 0 6px' }}>Offered to {pendingOffers.length}; first to accept is booked.</p>
                        {pendingOffers.map(o => (
                          <div key={o.id} className="panel-row">
                            <span>{o.workerName ?? o.name ?? candidates.find(c => c.workerId === o.workerId)?.name}</span>
                            <span style={{ display: 'flex', gap: 6 }}>
                              <form action={recordReply.bind(null, o.id, 'accept')}><input type="hidden" name="back" value={here} /><button className="btn small">Accepted</button></form>
                              <form action={recordReply.bind(null, o.id, 'decline')}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Declined</button></form>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {declinedOffers.length > 0 && (
                      <p className="muted small" style={{ margin: 0 }}>
                        Said no: {declinedOffers.map(o => `${o.workerName ?? o.name ?? ''}${o.respondedVia === 'link' ? ' (by link)' : ''}`).join(', ')}
                      </p>
                    )}
                    {bankReady.length > 0 && (
                      <form action={offer.bind(null, selected.id)} className="bankfill">
                        <input type="hidden" name="back" value={here} />
                        <p style={{ margin: '0 0 6px' }}><strong>Bank fill</strong> <span className="muted">· your bank and casual staff who can work it</span></p>
                        {bankReady.slice(0, 10).map(c => (
                          <label key={c.workerId} className="inline">
                            <input type="checkbox" name="workerIds" value={c.workerId} defaultChecked />
                            {c.name} <span className="muted">· {TYPE_SHORT[c.employmentType ?? ''] ?? ''} · {fmtHours(c.weekHours)} h this week</span>
                          </label>
                        ))}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                          <label className="inline">Offer closes in
                            <select name="expiresInMinutes" defaultValue="0">
                              <option value="0">no limit</option><option value="30">30 min</option><option value="60">1 hour</option><option value="240">4 hours</option>
                            </select>
                          </label>
                          <button className="btn small">Send offer</button>
                        </div>
                      </form>
                    )}
                    <p style={{ margin: '10px 0 4px' }}><strong>Assign directly</strong></p>
                    {candidates.filter(c => c.eligible).slice(0, 8).map(c => (
                      <div key={c.workerId} className="panel-row">
                        <span>
                          {c.name} <span className="muted">· {fmtHours(c.weekHours)} h this week</span>
                          {c.warnings.map(w => <span key={w.message} className="warnline">⚠ {w.message}</span>)}
                        </span>
                        <form action={assign.bind(null, selected.id, c.workerId)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Assign</button></form>
                      </div>
                    ))}
                    {candidates.filter(c => c.eligible).length === 0 && <p className="muted">Nobody on your staff can work this {tw.lower(T.shift)}.</p>}
                    {candidates.some(c => !c.eligible) && (
                      <details>
                        <summary className="muted" style={{ cursor: 'pointer' }}>Can&apos;t work it ({candidates.filter(c => !c.eligible).length})</summary>
                        {candidates.filter(c => !c.eligible).map(c => (
                          <div key={c.workerId} className="blocked"><strong>{c.name}</strong>{c.blocks.map(b => <span key={b.message}>{b.message}</span>)}</div>
                        ))}
                      </details>
                    )}
                    <p className="muted small" style={{ marginTop: 10 }}>{tw.one(T.agency)} fill comes next: send the {tw.lower(T.shift)} to your {tw.lower(T.agency, true)} when your own staff can&apos;t cover it.</p>
                  </>
                )}
              </section>
            )}

            {!selected.equipmentOnly && (() => {
              // Steve's "T" line: who this shift covers (e.g. someone on leave). People away that day come first.
              const choices = coveringChoices(roster.people, roster.leave ?? [], selected.localDate,
                { id: selected.coveringWorkerId ?? null, name: selected.coveringName ?? null }, selected.workerId);
              const awayCount = choices.filter(c => c.away).length;
              return (
                <section>
                  <h3>Covering</h3>
                  <form action={setCovering.bind(null, selected.id)} className="inline-form" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="hidden" name="back" value={here} />
                    <label className="sr-only" htmlFor="coveringWorkerId">Who this {tw.lower(T.shift)} is covering</label>
                    <select id="coveringWorkerId" name="workerId" defaultValue={selected.coveringWorkerId ?? ''}>
                      <option value="">Nobody</option>
                      {awayCount > 0 && <optgroup label="Away that day">{choices.filter(c => c.away).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>}
                      <optgroup label={awayCount > 0 ? `Other ${tw.lower(T.worker, true)}` : tw.many(T.worker)}>{choices.filter(c => !c.away).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
                    </select>
                    <button className="btn small secondary">Save</button>
                  </form>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>Shown on the card as &ldquo;Covering &lt;name&gt;&rdquo;, never the reason they&apos;re away.</p>
                </section>
              );
            })()}

            {(duties.some(d => d.active) || !!selected.duties?.length) && (
              <section>
                <h3>Duties</h3>
                <form action={setDuties.bind(null, selected.id)} className="duty-list">
                  <input type="hidden" name="back" value={here} />
                  {duties.filter(d => d.active || selected.duties?.some(x => x.id === d.id)).map(d => (
                    <label key={d.id} className="inline">
                      <input type="checkbox" name="dutyIds" value={d.id} defaultChecked={selected.duties?.some(x => x.id === d.id)} disabled={!d.active && !selected.duties?.some(x => x.id === d.id)} />
                      <span>{d.name}{d.requirements.some(r => r.severity !== 'optional') && <span className="muted small"> · needs {d.requirements.filter(r => r.severity !== 'optional').map(r => r.typeName).join(', ')}</span>}{!d.active && <span className="muted small"> (switched off)</span>}</span>
                    </label>
                  ))}
                  <button className="btn small secondary">Save duties</button>
                </form>
              </section>
            )}

            <section>
              <h3>{tw.many(T.equipment)}</h3>
              {(selected.equipment ?? []).map(e => (
                <div key={e.id} className="panel-row">
                  <span>{e.name} <span className="muted">· {e.typeName}</span></span>
                  <form action={removeEquipment.bind(null, selected.id, e.id)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Remove</button></form>
                </div>
              ))}
              {equipCandidates.filter(c => c.eligible && !(selected.equipment ?? []).some(e => e.id === c.equipmentId)).slice(0, 6).map(c => (
                <div key={c.equipmentId} className="panel-row">
                  <span>{c.name} <span className="muted">· {c.typeName}</span>{c.warnings.map(w => <span key={w.message} className="warnline">⚠ {w.message}</span>)}</span>
                  <form action={bookEquipment.bind(null, selected.id, c.equipmentId)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Book</button></form>
                </div>
              ))}
              {equipCandidates.length === 0 && !(selected.equipment ?? []).length && <p className="muted">No {tw.lower(T.equipment)} registered yet.</p>}
              {equipCandidates.some(c => !c.eligible) && (
                <details>
                  <summary className="muted" style={{ cursor: 'pointer' }}>Unavailable ({equipCandidates.filter(c => !c.eligible).length})</summary>
                  {equipCandidates.filter(c => !c.eligible).map(c => (
                    <div key={c.equipmentId} className="blocked"><strong>{c.name}</strong>{c.blocks.map(b => <span key={b.message}>{b.message}</span>)}</div>
                  ))}
                </details>
              )}
            </section>

            {itemsSection}

            <section>
              <form action={cancelShift.bind(null, selected.id)} className="form-row">
                <input type="hidden" name="back" value={url({ shift: undefined })} />
                <label>Cancel {tw.lower(T.shift)}: reason<input name="reason" required maxLength={300} placeholder="e.g. Function cancelled" /></label>
                <button className="btn small secondary">Cancel {tw.lower(T.shift)}</button>
              </form>
            </section>
            </>)}
            {shiftHistory.length > 0 && (
              <details className="shift-history">
                <summary className="muted" style={{ cursor: 'pointer' }}>History ({shiftHistory.length})</summary>
                <ol>
                  {shiftHistory.map(c => (
                    <li key={c.id}><span className="muted small">{when(c.at)}</span> {c.summary} <span className="muted small">{byWhom(c)}</span>{c.afterPublish && <b className="pill live small">after publishing</b>}</li>
                  ))}
                </ol>
              </details>
            )}
          </aside>
        )}
      </div>
      )}

      <div className="roster-legend">
        <span><i className="band am" /> A = AM (from 5am)</span><span><i className="band pm" /> P = PM (from midday)</span><span><i className="band nd" /> N = Night (from 7pm)</span><span className="muted">or the letter of the shift type</span><span><i className="leave-key" /> Leave</span>
        <span><i className="rb accepted" /> Accepted (when approval is on)</span>
      </div>

      {/* Stage counts for what's on screen, always in view along the bottom (David, 29 Oct, after Deputy's status bar). */}
      <div className="roster-statusbar" aria-label={`${tw.many(T.shift)} by stage`}>
        {([['unfilled', 'Unfilled'], ['offered', 'Offered'], ['allocated', 'Allocated'], ['accepted', 'Accepted'], ['pulled', 'Pulled out'], ['booked', 'Booked'], ['cancelled', 'Cancelled']] as const)
          .filter(([cls]) => cls !== 'accepted' || stageCounts.get(cls))
          .map(([cls, label]) => (
            <span key={cls} className={stageCounts.get(cls) ? undefined : 'muted'}><i className={`rb ${cls}`} /> <b>{stageCounts.get(cls) ?? 0}</b> {label}</span>
          ))}
        {attention && attention.total > 0 && <span className="att-count"><b>{attention.total}</b> need attention{attention.urgent > 0 && <> · <b className="bad">{attention.urgent}</b> within a day</>}</span>}
      </div>
    </div>
  );
}
