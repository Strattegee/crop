import Link from 'next/link';
import type { ReactNode } from 'react';
import { T, type Words } from '../../../lib/terms';
import {
  OUTCOME_TABS, QUEUE_BANDS, clearFiltersHref, queueHidden, officeChipList, bandTitle, bestPeople, inTeam, teamChoicesOn, teamOn, dayGroups, dayHeading, isOutcomeStage, periodChoices, releasableRows, hereLine, nearHereLine, initials, personLine, queueHref,
  showMore, stagePill, startsIn, tabLabel, tabsFor, waitingFor,
  type DayTotals, type QueueBand, type QueueParams, type QueueStage, type QueueTab, type QueueTeam, type QueueWords,
} from '../../../lib/allocation-queue';
import { cancelKindChoices } from '../../../lib/cancel-kinds';
import { clientConfirmLine, dayLabel, findStaffHref, rankChip } from '../../../lib/client-orders';
import { assign, cancelShift, clientConfirmed, confirm, offer, recordReply, unassign, undoClientConfirmed } from '../roster/actions';
import { AgencyFillSection, type AgencyFillState } from '../roster/agency-fill-section';
import { offerFromQueue, releaseMany } from './actions';
import { QueueLive } from './queue-live';
import { LogCall } from './log-call';
import { DISTANCE_TITLE } from '../../../lib/distance';
import { callLine, callWith, type CallRow } from '../../../lib/calls';
import { CancelKindField } from '../../../lib/cancel-kinds';
import {
  BAND_LABEL, HRS_LABEL, NO_QUEUE_FILTERS, ON_LABEL, PART_LABEL, PROGRESS_LABEL, RANK_CHOICES, WAITING_LABEL, dateChoiceLabel, filtersOn, nextSort,
  placeSummary, rankLabel, sortMark, sortedLine, whenSummary, withChosen, type FilterOptions, type SortKey,
} from '../../../lib/queue-filters';
import { ColumnFilterForm } from '../column-filter-form';
import { ChoiceList, ColumnMulti, ColumnPop, ColumnSelect } from '../column-filters';

export type QueueRow = {
  id: string; facilityId: string; facilityName: string; region: string | null; officeName?: string | null; areaName: string | null; role: string; status: string;
  startsAt: string; localDate: string; localStart: string; localEnd: string; dayLabel: string; hours: number; genderRequested: 'F' | 'M' | null; notes: string | null;
  clientId: string; clientName: string; clientRank: number | null; clientConfirms: boolean;
  orderId: string | null; clientReference: string | null; channelWords: string | null; requestedByName: string | null; orderNotes: string | null;
  workerId: string | null; workerName: string | null; clientConfirmedAt: string | null;
  offersTotal: number; offersPending: number; offersDeclined: number; pulledOutName: string | null; withAgencies: boolean;
  waitingSince: string | null; stage: QueueStage; band: QueueBand; progress: string; presence: { name: string; initials: string }[]; youAreOn: boolean;
  ended?: boolean; cancelKind?: string | null; cancelWords?: string | null;
};
export type Queue = {
  counts: Record<QueueTab, number>; regions: { name: string; count: number }[];
  period?: string | null; from?: string | null; to?: string | null; doneDays?: DayTotals[]; more?: number;
  office?: string | null; myOffices?: string[]; offices?: { id: string; name: string; count: number; mine: boolean }[]; noOffice?: number; bands: Record<QueueBand, number>; total: number; shifts: QueueRow[];
  /** What the column filters can offer on this tab (7 Nov). */
  options?: FilterOptions;
};
type Reason = { code: string; message: string };
export type PanelCandidate = { workerId: string; name: string; weekHours: number; eligible: boolean; available: boolean; blocks: Reason[]; warnings: Reason[]; offer?: { id: string; status: string } | null;
  siteHistory?: { shiftsHere: number; lastHere: string | null };
  /** Approximate straight-line km from their home postcode to the site (null = unknown); display only. */
  distanceKm?: number | null;
  /** On the site's team that day (projects, 4 Nov): the API lists the team first; shown as a mark only. */
  team?: { teamRole: string; areaName: string | null } | null };
export type PanelOffer = { id: string; workerId: string; workerName?: string; name?: string; status: string; respondedVia?: string | null };
export type PanelShift = {
  id: string; facilityId: string; facilityName: string; areaName: string | null; role: string; status: string; localDate: string; localStart: string; localEnd: string;
  startsAt: string; hours: number; workerId?: string | null; workerName: string | null; assignmentStatus: string | null; agencyName: string | null; notes: string | null; genderRequested: 'F' | 'M' | null;
  clientConfirms?: boolean; clientConfirmedAt?: string | null; clientConfirmedBy?: string | null; offersPending: number; pulledOutName: string | null;
  endsAt?: string; cancelKind?: string | null; cancelledReason?: string | null;
};
export type HistoryRow = { id: string; summary: string; actorName: string | null; at: string };
/** `done`: the shift has ended or was cancelled, so the panel shows what happened instead of ways to fill it. */
export type Panel = {
  shift: PanelShift; row: QueueRow | null; candidates: PanelCandidate[]; offers: PanelOffer[]; agency: AgencyFillState | null; calls?: CallRow[]; today?: string;
  done?: boolean; history?: HistoryRow[];
  /** The business's standing teams, for the best people's team choice (empty for people limited to some sites). */
  teams?: QueueTeam[];
};

const GENDER = { F: 'Female requested', M: 'Male requested' } as const;

/**
 * Allocations, layout A (David, 2 Nov): one queue of client shifts still needing work, banded by how soon they start,
 * with a fill panel for the open one (`shift=` in the URL). Built for speed: ~20 rows on a laptop, keyboard shortcuts,
 * refreshed every 20 seconds. Nothing is locked; the API decides when two people act at once.
 */
export function QueueScreen({ tw, p, q, clients, panel, now, when }: {
  tw: Words; p: QueueParams; q: Queue | null; clients: { id: string; name: string }[]; panel: Panel | null; now: number; when: (iso: string) => string;
}) {
  const qw: QueueWords = { client: tw.one(T.client), worker: tw.one(T.worker), bank: tw.lower(T.bank), shifts: tw.lower(T.shift, true) };
  const href = (c: Partial<QueueParams>) => queueHref(p, c);
  const here = href({});
  const officeChips = q ? officeChipList({ office: q.office ?? null, myOffices: q.myOffices ?? [], offices: q.offices ?? [], noOffice: q.noOffice ?? 0 }) : [];
  const grouped = p.sort ? [] : (q?.shifts ?? []);
  const bands = QUEUE_BANDS.map(b => ({ band: b, rows: grouped.filter(r => r.band === b) })).filter(b => b.rows.length);
  // Ended and cancelled shifts (calendar periods): by day, latest first, each day headed with its totals on this tab.
  const days = dayGroups(grouped.filter(r => r.band === 'done'));
  const dayTotals = new Map((q?.doneDays ?? []).map(d => [d.date, d]));
  const more = q ? showMore(p, q.shifts.length, q.more ?? 0) : null;
  const tabs = tabsFor(p.period ?? null);
  const doneTab = (OUTCOME_TABS as readonly string[]).includes(p.stage);
  const f = p.f ?? NO_QUEUE_FILTERS;
  const nFilters = filtersOn(f);
  const sorted = Boolean(p.sort);
  // Sorted by a heading: one list in that order instead of the bands and days.
  const flat = sorted ? (q?.shifts ?? []) : [];
  const sortLink = (key: SortKey, label: string, title?: string) => (
    <Link href={href({ sort: nextSort(p.sort, key), limit: null })} scroll={false} className="q-sortlink" title={title}
      aria-label={`Sort by ${(title ?? label).toLowerCase()}`}>{label}{sortMark(p.sort, key)}</Link>
  );
  const row = (r: QueueRow) => {
    const done = isOutcomeStage(r.stage);
    const st = startsIn(r.startsAt, now, r);
    const pill = stagePill(r.stage, qw, r.cancelKind ?? null);
    const rank = rankChip(r.clientRank);
    const sel = p.shift === r.id;
    return (
      <Link key={r.id} href={href({ shift: sel ? null : r.id })} scroll={false} data-qrow role="row"
        className={`q-row${sel ? ' sel' : ''}${r.stage === 'pulled_out' ? ' q-pulled' : ''}${done ? ' q-done' : ''}`} aria-current={sel ? 'true' : undefined}>
        {done ? <span className="q-starts muted">{r.ended ? 'Ended' : st.text}</span> : <span className={`q-starts ${st.tone}`}>{st.text}</span>}
        <span className="muted">{done ? '–' : waitingFor(r.waitingSince, now)}</span>
        <span><span className={`q-pill ${pill.cls}`}>{pill.label}</span></span>
        <span>{rank ? <span className={`q-rank${(r.clientRank ?? 9) <= 2 ? ' top' : ''}`} title={`${tw.one(T.client)} rank`}>{r.clientRank}</span> : <span className="muted">–</span>}</span>
        <span className="cut">{r.clientName} · {r.facilityName}{r.areaName ? ` · ${r.areaName}` : ''}</span>
        <span className="cut">{r.role}{r.genderRequested ? <span className="muted"> ({r.genderRequested})</span> : null}</span>
        <span className="cut muted">{r.dayLabel} {r.localStart}–{r.localEnd}</span>
        <span className="muted">{r.hours}</span>
        <span className="cut muted" title={r.progress}>{r.progress}</span>
        <span className="q-on">{r.presence.slice(0, 2).map(x => <span key={x.name} className="q-av" title={`${x.name} has this open`}>{x.initials}</span>)}</span>
      </Link>
    );
  };
  return (
    <div className="q-screen">
      <div className="q-filters">
        <form action="/allocations" className="q-selects">
          {queueHidden(p, ['clientId', 'period', 'days', 'shift', 'dates']).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr-only" htmlFor="q-client">{tw.one(T.client)}</label>
          <select id="q-client" name="clientId" defaultValue={p.clientId ?? ''} className="q-select">
            <option value="">Every {tw.lower(T.client)}</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="q-days">Period</label>
          <select id="q-days" name="period" defaultValue={p.period ?? String(p.days)} className="q-select">
            {periodChoices().map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <button className="btn small secondary">Show</button>
        </form>
        {officeChips.length > 0 && (
          <nav className="q-chips" aria-label="Office">
            <span className="muted small">Office:</span>
            {officeChips.map(c => (
              <Link key={c.value ?? 'default'} className={`q-chip${c.on ? ' on' : ''}`} href={href({ office: c.value, region: null, shift: null })} scroll={false}
                aria-current={c.on ? 'true' : undefined}>{c.label}{c.count !== null && <> <b>{c.count}</b></>}</Link>
            ))}
          </nav>
        )}
        {officeChips.length === 0 && (q?.regions.length ?? 0) > 0 && (
          <nav className="q-chips" aria-label="Region">
            <span className="muted small">Region:</span>
            <Link className={`q-chip${p.region ? '' : ' on'}`} href={href({ region: null, shift: null })} scroll={false}>All</Link>
            {q!.regions.map(r => (
              <Link key={r.name} className={`q-chip${p.region === r.name ? ' on' : ''}`} href={href({ region: r.name, shift: null })} scroll={false}>{r.name} <b>{r.count}</b></Link>
            ))}
          </nav>
        )}
        <QueueLive closeHref={href({ shift: null })} shiftId={p.shift} />
      </div>
      <nav className="q-tabs" aria-label="Stage">
        {tabs.map(t => (
          <span key={t} style={{ display: 'contents' }}>
            {t === 'done' && <span className="q-tabs-sep" aria-hidden="true">Ended or cancelled</span>}
            <Link className={`q-tab${p.stage === t ? ' on' : ''}`} href={href({ stage: t, shift: null, limit: null, f: { ...f, stages: [] } })} scroll={false} aria-current={p.stage === t ? 'page' : undefined}>
              <span className={`q-dot qd-${t}`} aria-hidden="true" />{tabLabel(t, qw)} <b>{q?.counts[t] ?? 0}</b>
            </Link>
          </span>
        ))}
      </nav>

      <input type="checkbox" id="q-ftoggle" className="q-ftoggle sr-only" defaultChecked={nFilters > 0} aria-label="Show the filters" />
      <div className="q-fbar">
        <label htmlFor="q-ftoggle" className="btn small secondary q-fbtn">Filters{nFilters ? ` (${nFilters})` : ''}</label>
        {nFilters > 0 && <span className="muted small">{q ? `${q.total} ${q.total === 1 ? tw.lower(T.shift) : qw.shifts} match the filters` : ''}</span>}
        {nFilters > 0 && <Link href={clearFiltersHref(p)} className="small" scroll={false}>Clear filters</Link>}
      </div>
      <div className={`q-main${panel ? ' with-panel' : ''}`}>
        <section className="q-list" aria-label={tw.many(T.shift)}>
          <div className="q-scroll">
            <div className="q-table" role="table">
              <div className="q-row q-head" role="row">
                {sortLink('starts', 'Starts in')}{sortLink('waiting', 'Waiting')}{sortLink('stage', 'Stage')}
                {sortLink('rank', 'Rank', `${tw.one(T.client)} rank, 1 = most loyal`)}
                {sortLink('client', `${tw.one(T.client)} · ${tw.lower(T.site)} · ${tw.lower(T.area)}`)}{sortLink('role', tw.one(T.role))}
                {sortLink('when', 'When')}{sortLink('hours', 'Hrs', 'Hours')}{sortLink('progress', 'Progress')}{sortLink('on', 'On', 'Who else has it open')}
              </div>
              <QueueFilterRow tw={tw} qw={qw} p={p} f={f} o={q?.options} />
              {!q && <p className="q-empty">Couldn&apos;t load the {qw.shifts}. It tries again in a moment.</p>}
              {q && q.shifts.length === 0 && nFilters > 0 && (
                <p className="q-empty">Nothing here matches the filters. <Link href={clearFiltersHref(p)} scroll={false}>Clear filters</Link></p>
              )}
              {q && q.shifts.length === 0 && nFilters === 0 && (
                <p className="q-empty">{p.stage === 'booked_today' ? `Nothing booked today yet${p.region ? ` in ${p.region}` : ''}.`
                  : doneTab ? `No ${qw.shifts} here have ended or been cancelled in this period.`
                    : `Nothing needs anyone here. New orders show up as soon as they're saved.`}</p>
              )}
              {bands.map(b => (
                <div key={b.band} role="rowgroup">
                  <div className={`q-band qb-${b.band}`} role="row">
                    <span>{bandTitle(b.band)} <b>{b.rows.length}</b></span>
                    {(b.band === 'soon' || b.band === 'started') && <span className="q-band-hint">soonest first; higher-ranked {tw.lower(T.client, true)} first at the same time</span>}
                    <BulkRelease tw={tw} qw={qw} rows={releasableRows(b.rows)} here={here} title={bandTitle(b.band).toLowerCase()} />
                  </div>
                  {b.rows.map(row)}
                </div>
              ))}
              {flat.length > 0 && (
                <div role="rowgroup">
                  <div className="q-band" role="row">
                    <span>{sortedLine(p.sort!, { client: tw.one(T.client), role: tw.one(T.role) })} <b>{q?.total ?? flat.length}</b></span>
                    <Link href={href({ sort: null })} scroll={false} className="q-band-hint">Back to the queue order</Link>
                    <BulkRelease tw={tw} qw={qw} rows={releasableRows(flat)} here={here} title="this list" />
                  </div>
                  {flat.map(row)}
                </div>
              )}
              {days.map(d => (
                <div key={d.date} role="rowgroup">
                  <div className="q-band qb-done" role="row">
                    <span>{dayHeading(dayTotals.get(d.date) ?? { date: d.date, total: d.rows.length, worked: 0, unfilled: 0, cancelled: 0 })}</span>
                  </div>
                  {d.rows.map(row)}
                </div>
              ))}
              {more && <div className="q-more"><Link href={more.href} scroll={false}>{more.label}</Link></div>}
            </div>
          </div>
          <div className="q-foot">
            <span><kbd>J</kbd> <kbd>K</kbd> move</span><span><kbd>Enter</kbd> open</span>
            {!doneTab && <><span><kbd>A</kbd> assign top person</span><span><kbd>O</kbd> offer to top 5</span><span><kbd>R</kbd> release to {qw.bank}</span></>}
            <span><kbd>Esc</kbd> close</span>
            <span className="q-foot-count">{q ? `${q.total} ${q.total === 1 ? tw.lower(T.shift) : qw.shifts}${q.more ? ` (${q.shifts.length} shown)` : ''}` : ''} · nothing is locked: if two people act, the first wins and the other is told</span>
          </div>
        </section>
        {panel && (panel.done
          ? <OutcomePanel tw={tw} qw={qw} panel={panel} closeHref={href({ shift: null })} when={when} />
          : <FillPanel tw={tw} qw={qw} panel={panel} here={here} closeHref={href({ shift: null })} nearHref={href({ near: !p.near })} near={!!p.near} now={now} when={when}
            crew={p.crew ?? null} crewHref={(crew: string | null) => href({ crew })} />)}
      </div>
    </div>
  );
}

/**
 * The filter row under the queue's headings (David, 7 Nov: "as per what you have done on Recruitment"): one compact
 * drop-down per column in one GET form, with the rest of the page's state as hidden fields so links, Back, the refresh
 * and the open panel keep it. Choices come from the API (`options`: what's on this tab before the column filters).
 */
function QueueFilterRow({ tw, qw, p, f, o }: { tw: Words; qw: QueueWords; p: QueueParams; f: NonNullable<QueueParams['f']>; o: FilterOptions | undefined }) {
  const opts: FilterOptions = o ?? { stages: [], clients: [], sites: [], roles: [], dates: [] };
  const stageLabel = (s: string) => stagePill(s as QueueStage, qw).label;
  const bandChoices = [...QUEUE_BANDS, ...(p.period ? ['done' as const] : [])].map(b => ({ value: b, label: BAND_LABEL[b]! }));
  const pairs = (rec: Record<string, string>) => Object.entries(rec).map(([value, label]) => ({ value, label }));
  const clientName = new Map(opts.clients.map(c => [c.id, c.name]));
  const siteChoices = withChosen(opts.sites.map(s => ({ value: s.id.toLowerCase(), label: s.name, group: clientName.get(s.clientId) })), f.sites, () => `Chosen ${tw.lower(T.site)}`);
  const placeOn = f.clients.length + f.sites.length > 0 || Boolean(f.area);
  const cell = (label: string, child: ReactNode) => <span role="columnheader" className="q-fcell" data-label={label}>{child}</span>;
  return (
    <ColumnFilterForm id="q-filters" action="/allocations" className="q-row q-fhead" label={`Filter the ${qw.shifts}`}>
      {queueHidden(p, ['band', 'waiting', 'stages', 'rank', 'clients', 'sites', 'area', 'roles', 'dates', 'part', 'hrs', 'progress', 'on'])
        .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {cell('Starts in', <ColumnMulti name="band" label="Starts in" chosen={f.band} options={bandChoices} />)}
      {cell('Waiting', <ColumnSelect name="waiting" label="Waiting" value={f.waiting} options={pairs(WAITING_LABEL)} />)}
      {cell('Stage', <ColumnMulti name="stages" label="Stage" chosen={f.stages} options={withChosen(opts.stages.map(s => ({ value: s, label: stageLabel(s) })), f.stages, stageLabel)} />)}
      {cell('Rank', <ColumnMulti name="rank" label={`${tw.one(T.client)} rank`} chosen={f.rank} options={RANK_CHOICES.map(r => ({ value: r, label: rankLabel(r) }))} />)}
      {cell(`${tw.one(T.client)} · ${tw.lower(T.site)} · ${tw.lower(T.area)}`, (
        <ColumnPop summary={placeSummary(f, opts)} on={placeOn} label={`${tw.one(T.client)}, ${tw.lower(T.site)} or ${tw.lower(T.area)}`}>
          <b className="rl-group">{tw.many(T.client)}</b>
          <ChoiceList name="clients" chosen={f.clients} options={withChosen(opts.clients.map(c => ({ value: c.id.toLowerCase(), label: c.name })), f.clients, () => `Chosen ${tw.lower(T.client)}`)} />
          <b className="rl-group">{tw.many(T.site)}{f.clients.length ? ` of the chosen ${tw.lower(T.client, true)}` : ''}</b>
          <ChoiceList name="sites" chosen={f.sites} options={siteChoices} />
          <label>{tw.one(T.area)} name has<input name="area" defaultValue={f.area} maxLength={60} className="rl-text" placeholder={`Part of ${tw.lower(T.area)}'s name`} /></label>
        </ColumnPop>
      ))}
      {cell(tw.one(T.role), <ColumnMulti name="roles" label={tw.one(T.role)} chosen={f.roles} options={withChosen(opts.roles.map(r => ({ value: r, label: r })), f.roles)} />)}
      {cell('When', (
        <ColumnPop summary={whenSummary(f)} on={f.dates.length + f.part.length > 0} label="When">
          <b className="rl-group">Part of the day</b>
          <ChoiceList name="part" chosen={f.part} options={pairs(PART_LABEL)} />
          <b className="rl-group">Day</b>
          <ChoiceList name="dates" chosen={f.dates} options={withChosen(opts.dates.map(d => ({ value: d, label: dateChoiceLabel(d) })), f.dates, dateChoiceLabel)} />
        </ColumnPop>
      ))}
      {cell('Hours', <ColumnSelect name="hrs" label="Hours" value={f.hrs} options={pairs(HRS_LABEL)} />)}
      {cell('Progress', <ColumnMulti name="progress" label="Progress" chosen={f.progress} options={pairs(PROGRESS_LABEL)} />)}
      {cell('On', <ColumnSelect name="on" label="Who else has it open" value={f.on} options={pairs(ON_LABEL)} />)}
      <button className="sr-only">Apply filters</button>
    </ColumnFilterForm>
  );
}

/**
 * "Release N new": offers every New shift in a band to everyone who can work it, in one press (layout C's release in
 * bulk, inside the queue). Opens a small confirm first (`data-hold` stops the 20-second refresh while it's open).
 */
function BulkRelease({ tw, qw, rows, here, title }: { tw: Words; qw: QueueWords; rows: { id: string }[]; here: string; title: string }) {
  if (rows.length < 2) return null;
  const n = `${rows.length} ${qw.shifts}`;
  return (
    <details className="q-bulk" data-hold>
      <summary>Release {rows.length} new</summary>
      <form action={releaseMany} className="q-bulk-pop">
        <input type="hidden" name="back" value={here} />
        {rows.map(r => <input key={r.id} type="hidden" name="shiftId" value={r.id} />)}
        <p>Offer the {n} still new in <strong>{title}</strong> to everyone who can work each one, as its own Release button would.</p>
        <p className="muted small">Each person gets a message for every {tw.lower(T.shift)} they can work; the first to accept each one gets it. Any that someone fills meanwhile are skipped.</p>
        <button className="btn small">Release {n} to the {qw.bank}</button>
      </form>
    </details>
  );
}

function FillPanel({ tw, qw, panel, here, closeHref, nearHref, near, now, when, crew, crewHref }: {
  tw: Words; qw: QueueWords; panel: Panel; here: string; closeHref: string; nearHref: string; near: boolean; now: number; when: (iso: string) => string;
  crew: string | null; crewHref: (crew: string | null) => string;
}) {
  const { shift: s, row: r } = panel;
  const shift = tw.lower(T.shift), client = tw.lower(T.client);
  const st = startsIn(s.startsAt, now, { dayLabel: r?.dayLabel ?? '', localStart: s.localStart });
  const meta = [r?.clientReference ? `ref ${r.clientReference}` : null, r?.channelWords ? `asked by ${r.channelWords.toLowerCase()}${r.requestedByName ? ` (${r.requestedByName})` : ''}` : null,
    r?.clientRank ? `rank ${r.clientRank} ${client}` : null, s.clientConfirms ? 'confirms each booking' : null].filter(Boolean).join(' · ');
  // A standing team chosen (`crew=`, 6 Nov): only its people on the shift's date, with the role they fill in it.
  const teams = panel.teams ?? [];
  const members = teamOn(teams, crew, s.localDate);
  const teamName = members ? teams.find(t => t.id === crew)?.name ?? '' : '';
  const teamChoices = teamChoicesOn(teams, s.localDate, crew);
  const best = bestPeople(inTeam(panel.candidates, members), 5, s.status === 'open' ? s.pulledOutName : null, near);
  const anyDistance = panel.candidates.some(c => c.distanceKm != null);
  const canWork = bestPeople(panel.candidates, 50, s.pulledOutName).length;
  const pending = panel.offers.filter(o => o.status === 'pending');
  const declined = panel.offers.filter(o => o.status === 'declined').length;
  const open = s.status === 'open';
  const cc = clientConfirmLine(s, client, when);
  const back = <input type="hidden" name="back" value={here} />;
  const pill = r ? stagePill(r.stage, qw) : null;
  return (
    <aside className="q-panel" id="fill-panel" aria-label={`Selected ${shift}`}>
      <div className="q-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          {meta && <div className="muted small">{meta}</div>}
          {r && (
            <div className="small">
              <LogCall back={here} shiftId={s.id} clientId={r.clientId} contactName={r.requestedByName}
                who={r.requestedByName ? `${r.requestedByName} (${r.clientName})` : r.clientName} label={`Log a call with the ${client}`} />
            </div>
          )}
          <h2>{s.role}</h2>
          <div>{r?.clientName ? `${r.clientName} – ` : ''}{s.facilityName}{s.areaName ? `, ${s.areaName}` : ''}</div>
          <div className="muted small">{dayLabel(s.localDate)} · {s.localStart}–{s.localEnd} · {s.hours}&nbsp;h</div>
        </div>
        <span className={`q-pill q-starts-pill ${st.tone}`}>{st.text.startsWith('Started') ? st.text : st.text.endsWith(' ago') ? `Started ${st.text}` : `Starts in ${st.text}`}</span>
        <Link href={closeHref} scroll={false} className="q-close" aria-label="Close">×</Link>
      </div>
      <div className="q-pills">
        {pill && <span className={`q-pill ${pill.cls}`}>{pill.label}</span>}
        {panel.offers.length > 0 && <span className="q-pill q-soft">Offered {panel.offers.length}{declined ? ` · ${declined} declined` : ''}{pending.length ? ` · ${pending.length} waiting` : ''}</span>}
        {s.genderRequested && <span className="q-pill q-soft">{GENDER[s.genderRequested]}</span>}
        {r?.presence.map(x => <span key={x.name} className="q-pill q-soft" title="Has it open now; it never blocks you">{x.name} is on it</span>)}
      </div>
      {s.pulledOutName && open && <p className="notice error" style={{ margin: 0 }}>{s.pulledOutName} pulled out. Fill it again below.</p>}
      {r?.orderNotes && <div className="q-note"><strong>{tw.one(T.client)} note:</strong> {r.orderNotes}</div>}
      {s.notes && <div className="q-note"><strong>{tw.one(T.shift)} note:</strong> {s.notes}</div>}

      {s.workerName ? (
        <div className="q-section">
          <div className="q-person">
            <span className="q-av big">{initials(s.workerName)}</span>
            <div style={{ minWidth: 0 }}>
              <strong>{s.workerName}</strong>{s.agencyName ? <span className="muted"> · {s.agencyName}</span> : null}
              <div className="muted small">{s.status === 'booked' ? 'Confirmed' : 'Waiting for them to confirm'}</div>
            </div>
          </div>
          {cc && <p className={cc.waiting ? 'notice small' : 'muted small'} style={{ margin: '6px 0 0' }}>{cc.text}</p>}
          <div className="q-actions">
            {s.status === 'assigned' && (
              <form action={confirm.bind(null, s.id)}>{back}<button className="btn small" title="They said yes">{s.agencyName ? 'Approve' : 'Confirm'}</button></form>
            )}
            {cc?.waiting && (
              <form action={clientConfirmed.bind(null, s.id)}>{back}<button className="btn small">{tw.one(T.client)} confirmed</button></form>
            )}
            {cc && !cc.waiting && (
              <form action={undoClientConfirmed.bind(null, s.id)}>{back}<button className="btn small secondary">Undo {client}&apos;s yes</button></form>
            )}
            <form action={unassign.bind(null, s.id)}>{back}<button className="btn small secondary">Remove</button></form>
            {s.workerId && !s.agencyName && <LogCall back={here} shiftId={s.id} workerId={s.workerId} who={s.workerName} />}
            <form action={unassign.bind(null, s.id)}>{back}<input type="hidden" name="pulledOut" value="1" /><button className="btn small secondary" title={`They can't do it: the ${shift} needs someone again`}>They pulled out</button></form>
          </div>
        </div>
      ) : open ? (
        <>
          <div className="q-section">
            <div className="q-section-head"><h3>Best people for this {shift}</h3><span className="muted small">checked for {tw.lower(T.role)}, {tw.lower(T.credential, true)}, availability, hours</span>
              {(anyDistance || near) && <Link href={nearHref} scroll={false} replace className={`q-sort small${near ? ' on' : ''}`} aria-pressed={near} title={DISTANCE_TITLE}>{near ? 'Nearest first ✓' : 'Nearest first'}</Link>}</div>
            {teamChoices.length > 0 && (
              <div className="q-teams small" aria-label={`Best people from one ${tw.lower(T.team)}`}>
                <span className="muted">{tw.one(T.team)}:</span>
                <Link href={crewHref(null)} scroll={false} replace className={`q-sort small${members ? '' : ' on'}`} aria-pressed={!members}>Anyone</Link>
                {teamChoices.map(t => (
                  <Link key={t.id} href={crewHref(t.id === crew ? null : t.id)} scroll={false} replace className={`q-sort small${t.id === crew ? ' on' : ''}`} aria-pressed={t.id === crew}
                    title={`${t.count} on it on ${dayLabel(s.localDate)}`}>{t.label}</Link>
                ))}
              </div>
            )}
            {best.length === 0 && <p className="muted small" style={{ margin: '4px 0' }}>{members
              ? <>Nobody in {teamName} can work it right now. <Link href={crewHref(null)} scroll={false} replace>Show everyone</Link></>
              : <>Nobody else can work it right now{pending.length ? ' (the people offered it are below)' : ''}.</>}</p>}
            {best.map((c, i) => (
              <div key={c.workerId} className="q-person">
                <span className="q-av">{initials(c.name)}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="q-name">{c.name}{members?.get(c.workerId) && <span className="badge neutral" style={{ marginLeft: 6 }} title={`Their place in ${teamName}`}>{members.get(c.workerId)}</span>}{c.team && <span className="badge neutral" style={{ marginLeft: 6 }} title="On this team">{c.team.teamRole === 'supervisor' ? 'Team supervisor' : 'Team'}</span>}</div>
                  <div className={`small cut ${c.warnings.length ? 'warnline' : 'muted'}`} title={c.warnings.map(w => w.message).join('. ')}>{personLine(c)}</div>
                  <div className={`small cut ${c.siteHistory?.shiftsHere ? 'q-here' : 'muted'}`} title={c.distanceKm != null ? DISTANCE_TITLE : undefined}>{nearHereLine(c.distanceKm, hereLine(c.siteHistory, s.localDate, tw.lower(T.site)))}</div>
                </div>
                <div className="q-person-btns">
                  <form action={offer.bind(null, s.id)}>{back}<input type="hidden" name="workerIds" value={c.workerId} /><button className="btn small secondary">Offer</button></form>
                  <form action={assign.bind(null, s.id, c.workerId)}>{back}<button className="btn small" data-key={i === 0 ? 'a' : undefined} title={i === 0 ? 'Shortcut: A' : undefined}>Assign</button></form>
                  <LogCall back={here} shiftId={s.id} workerId={c.workerId} who={c.name} label="Call" />
                </div>
              </div>
            ))}
          </div>
          <div className="q-big-actions">
            <form action={offerFromQueue.bind(null, s.id, 'top')}>{back}{near && <input type="hidden" name="near" value="1" />}{members && crew && <input type="hidden" name="crew" value={crew} />}
              <button className="btn secondary q-wide" data-key="o" disabled={best.length === 0}>Offer to the top {Math.min(5, best.length) || 5}{members ? ` in ${teamName}` : ''} <span className="muted">first to accept is booked</span></button>
            </form>
            <form action={offerFromQueue.bind(null, s.id, 'release')}>{back}
              <button className="btn secondary q-wide" data-key="r" disabled={canWork === 0}>Release to the {qw.bank} <span className="muted">{canWork} can work it</span></button>
            </form>
          </div>
          {pending.length > 0 && (
            <div className="q-section">
              <h3>Waiting for a reply</h3>
              {pending.map(o => (
                <div key={o.id} className="panel-row small">
                  <span>{o.workerName ?? o.name}</span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <form action={recordReply.bind(null, o.id, 'accept')}>{back}<button className="btn small secondary" title="They told you yes">They said yes</button></form>
                    <form action={recordReply.bind(null, o.id, 'decline')}>{back}<button className="btn small secondary">No</button></form>
                  </span>
                </div>
              ))}
            </div>
          )}
          {panel.agency && (panel.agency.activeAgencies > 0 || panel.agency.request) && <AgencyFillSection st={panel.agency} shiftId={s.id} here={here} when={when} tw={tw} />}
        </>
      ) : <p className="muted">This {shift} is {s.status}.</p>}
      {(panel.calls ?? []).length > 0 && (
        <div className="q-section">
          <h3>Calls about this {shift}</h3>
          <ul className="call-list">
            {panel.calls!.map(c => <li key={c.id}><strong>{callWith(c)}</strong> <span className="muted">{callLine(c, panel.today ?? '')}</span></li>)}
          </ul>
        </div>
      )}
      {s.status !== 'cancelled' && (
        <details className="q-section q-cancel" data-hold>
          <summary className="small" style={{ cursor: 'pointer' }}>Cancel this {shift}</summary>
          <form action={cancelShift.bind(null, s.id)} className="form-row" style={{ marginTop: 8 }}>
            <input type="hidden" name="back" value={closeHref} />
            <CancelKindField clientWord={tw.one(T.client)} forClient={Boolean(r?.clientId)} />
            <label>Reason<input name="reason" required maxLength={300} placeholder={`e.g. ${tw.one(T.client)} rang: ward closed`} /></label>
            <button className="btn small secondary">Cancel {shift}</button>
          </form>
        </details>
      )}
      <div className="q-panel-foot">
        <Link href={findStaffHref(s)}>Open in the {tw.lower(T.roster)}</Link>
        <span className="muted small">for duties, times, history and everything else</span>
      </div>
    </aside>
  );
}

const OFFER_WORDS: Record<string, string> = { pending: 'no reply', accepted: 'accepted', declined: 'said no', withdrawn: 'withdrawn', filled: 'filled by someone else', expired: 'expired' };

/**
 * The panel for a shift that has ended or was cancelled (calendar periods, David 4 Nov): what happened (who worked it,
 * who pulled out, why it was cancelled), who was offered it, calls logged and its history. Nothing to fill any more.
 */
function OutcomePanel({ tw, qw, panel, closeHref, when }: { tw: Words; qw: QueueWords; panel: Panel; closeHref: string; when: (iso: string) => string }) {
  const { shift: s, row: r } = panel;
  const shift = tw.lower(T.shift);
  const stage = r?.stage ?? (s.status === 'cancelled' ? 'cancelled' : s.status === 'booked' ? 'worked' : s.status === 'assigned' ? 'unconfirmed' : s.pulledOutName ? 'not_refilled' : 'unfilled');
  const pill = stagePill(stage, qw, s.cancelKind ?? r?.cancelKind ?? null);
  const kind = cancelKindChoices(tw.one(T.client), true).find(k => k.value === (s.cancelKind ?? 'other'))?.label ?? 'Other';
  const pulledName = s.pulledOutName ?? r?.pulledOutName ?? null;
  const what = (() => {
    switch (stage) {
      case 'worked': return <><strong>{s.workerName ?? 'Someone'}</strong>{s.agencyName ? ` (${s.agencyName})` : ''} worked it.</>;
      case 'unconfirmed': return <><strong>{s.workerName ?? 'Someone'}</strong> was allocated but never confirmed it.</>;
      case 'not_refilled': return <><strong>{pulledName ?? 'Someone'}</strong> pulled out and nobody replaced them.</>;
      case 'cancelled': return <>Cancelled. <strong>Why:</strong> {kind}{s.cancelledReason ? <> · {s.cancelledReason}</> : null}</>;
      default: return <>Nobody went.</>;
    }
  })();
  return (
    <aside className="q-panel" id="fill-panel" aria-label={`Selected ${shift}`}>
      <div className="q-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          {r?.clientReference && <div className="muted small">ref {r.clientReference}</div>}
          <h2>{s.role}</h2>
          <div>{r?.clientName ? `${r.clientName} – ` : ''}{s.facilityName}{s.areaName ? `, ${s.areaName}` : ''}</div>
          <div className="muted small">{dayLabel(s.localDate)} · {s.localStart}–{s.localEnd} · {s.hours}&nbsp;h</div>
        </div>
        <span className={`q-pill ${pill.cls}`}>{pill.label}</span>
        <Link href={closeHref} scroll={false} className="q-close" aria-label="Close">×</Link>
      </div>
      <div className="q-section">
        <h3>What happened</h3>
        <p style={{ margin: '4px 0 0' }}>{what}</p>
        {stage === 'worked' && pulledName && pulledName !== s.workerName && <p className="muted small" style={{ margin: '4px 0 0' }}>{pulledName} pulled out before them.</p>}
      </div>
      {r?.orderNotes && <div className="q-note"><strong>{tw.one(T.client)} note:</strong> {r.orderNotes}</div>}
      {panel.offers.length > 0 && (
        <div className="q-section">
          <h3>Offered to {panel.offers.length}</h3>
          <p className="small" style={{ margin: '4px 0 0' }}>
            {panel.offers.map((o, i) => <span key={o.id}>{i > 0 && ' · '}{o.workerName ?? o.name} <span className="muted">({OFFER_WORDS[o.status] ?? o.status})</span></span>)}
          </p>
        </div>
      )}
      <div className="q-section">
        <h3>Calls about this {shift}</h3>
        {(panel.calls ?? []).length === 0 ? <p className="muted small" style={{ margin: '4px 0 0' }}>None logged.</p> : (
          <ul className="call-list">
            {panel.calls!.map(c => <li key={c.id}><strong>{callWith(c)}</strong> <span className="muted">{callLine(c, panel.today ?? '')}</span></li>)}
          </ul>
        )}
      </div>
      {(panel.history ?? []).length > 0 && (
        <div className="q-section">
          <h3>History</h3>
          <ul className="call-list">
            {[...panel.history!].reverse().slice(0, 12).map(h => <li key={h.id}>{h.summary} <span className="muted">· {when(h.at)}{h.actorName ? ` · ${h.actorName}` : ''}</span></li>)}
          </ul>
        </div>
      )}
      <div className="q-panel-foot">
        <Link href={findStaffHref(s)}>Open in the {tw.lower(T.roster)}</Link>
        <span className="muted small">for its full history and everything else</span>
      </div>
    </aside>
  );
}
