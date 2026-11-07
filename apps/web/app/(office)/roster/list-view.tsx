import Link from 'next/link';
import type { ReactNode } from 'react';
import { T, type Words } from '../../../lib/terms';
import type { MarkerLetters } from '../../../lib/marker-letters';
import {
  BANDS, BAND_WORDS, FILTER_KEYS, GROUP_BYS, LENGTHS, LENGTH_WORDS, LIST_MAX, LIST_PAGE, PERIODS, PERIOD_WORDS, STAGE_ORDER, STAGE_WORDS, TLINES, TLINE_WORDS,
  WARNS, WARN_WORDS, areaChoices, chipOn, filterCount, filterShifts, groupLine, groupShifts, joinKnown, offAll, pageGroups, pickValue, roleEditColumn, rowEditable, sortMark, sortOver, splitList,
  stageClass, stageTally, type ListGroupBy, type ListParams, type ListShift, type ListSort, type MarkFilter, type RowFacts, type StageCls,
} from '../../../lib/roster-list';
import { UNCHECKED } from '../../../lib/outside-agency';
import { confirm, setRole, setTimes } from './actions';
import { BULK_FORM, LIST_FILTERS, ListTools } from './list-tools';
import { projectStageLine, requestsFor, shiftMarkers, tLines, type DayRequest, type MarkerShift, type ProjectStageShift } from './view';

/** A roster shift as the list needs it (`GET /roster` rows). */
export type ListRowShift = ListShift & MarkerShift & ProjectStageShift & { breakMinutes?: number; startsAt?: string; areaId?: string | null; agencyUnchecked?: boolean; clientId?: string | null; equipment?: { name: string; vehicle?: boolean }[] };

const fmtHours = (n: number) => (Math.round(n * 10) / 10).toString();
const shortDay = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)).replace(',', '');
const longDay = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/**
 * The roster's List view (David and Steve, 4 Nov): the same shifts as the cards, one compact row each, grouped and
 * filtered from the URL, with tick boxes for acting on several at once. A row opens the same shift panel as a card.
 */
export function ListView({ shifts, p, role, tw, letters, dayRequests, url, here, selectedId, allSites, weekDays, people, duties, blocked, gaps, refused, stageLabel, letterCol, closeHref, edit }: {
  shifts: ListRowShift[]; p: ListParams; role: string; tw: Words; letters: MarkerLetters; dayRequests: DayRequest[];
  url: (over: Record<string, string | undefined>) => string; here: string; selectedId: string | null; allSites: boolean;
  /** The week's days in week view (the Time column's day choices); null in day view. */
  weekDays: string[] | null;
  people: { id: string; name: string }[]; duties: { id: string; name: string }[];
  /** Hard blocks for the person or equipment on a shift (Needs attention, next 7 days), by shift. */
  blocked: Map<string, string>;
  /** Cover gaps by the shift they were found on. */
  gaps: Map<string, string>;
  /** Sites whose week this person can't change (after-publishing rule): no quick actions there, the panel asks instead. */
  refused: Set<string>;
  stageLabel: (s: ListRowShift) => string; letterCol: (s: ListRowShift) => ReactNode; closeHref: string | null;
  /**
   * Inline changes of day, times, role and area (7 Nov): whether this person may change a shift's details, the time to
   * compare starts with, each site's areas. Left out = no inline changes.
   */
  edit?: { canEdit: boolean; now: number; areas: Map<string, { id: string; name: string; active?: boolean }[]> };
}) {
  const shiftWord = tw.lower(T.shift), shiftsWord = tw.lower(T.shift, true);
  const count = (n: number) => tw.count(n, T.shift);

  // Choices for the filters, from the period's shifts (so a contractor's "Work areas" list stays theirs).
  const roles = [...new Set(shifts.filter(s => !s.equipmentOnly).map(s => s.role))].sort();
  const areas = [...new Set(shifts.map(s => s.areaName ?? '-'))].sort((a, b) => (a === '-' ? 1 : b === '-' ? -1 : a.localeCompare(b)));
  const persons = new Map<string, string>();
  for (const s of shifts) if (s.workerId && s.workerName) persons.set(s.workerId, s.workerName);
  const sites = new Map<string, string>();
  for (const s of shifts) sites.set(s.facilityId, s.facilityName);
  const pstages = new Map<string, string>();
  for (const s of shifts) if (s.projectStageId && s.projectStageName) pstages.set(s.projectStageId, s.projectStageName);
  // The Role column writes the strip's `role` (several = a comma list); names with commas come back whole.
  const chosenRoles = joinKnown(splitList(role), roles);
  const chosenAreas = joinKnown(p.areas, areas);
  const lp = { ...p, areas: chosenAreas };

  // Markers, blocks and gaps per row, worked out once (filters and the Warnings cell read them).
  const facts = new Map<string, RowFacts & { marksList: ReturnType<typeof shiftMarkers> }>();
  for (const s of shifts) {
    const cancelled = s.status === 'cancelled';
    const marksList = cancelled ? [] : shiftMarkers({ ...s, requests: requestsFor(s, dayRequests) }, letters);
    const kinds = new Set<MarkFilter>();
    if (s.genderRequested && !cancelled) kinds.add('gender');
    for (const m of marksList) {
      const k = ({ v: 'vehicle', e: 'equipment', i: 'items', d: 'duty', t: 'template', r: 'request' } as Record<string, MarkFilter>)[m.key];
      if (k) kinds.add(k);
    }
    facts.set(s.id, {
      marksList, marks: [...kinds], ringed: marksList.some(m => m.cls.includes('warn')),
      blocked: !cancelled && blocked.has(s.id), gap: !cancelled && gaps.has(s.id),
    });
  }
  const opts = { roles: chosenRoles, facts: (s: ListRowShift) => facts.get(s.id)!, weekDays, allSites };
  // Chips count what the other filters leave; the rows also apply the stage.
  const beforeStage = filterShifts(shifts, lp, { ...opts, except: 'stage' });
  const tally = stageTally(beforeStage);
  const rows = filterShifts(beforeStage, lp, opts);
  const groups = groupShifts(rows, p.group, { dateLabel: longDay, noArea: `No ${tw.lower(T.area)}`, unfilled: 'Unfilled', allSites }, { key: p.sort, desc: p.desc });
  const paged = pageGroups(groups, p.limit);
  const cols = {
    date: p.group !== 'date', site: allSites && p.group !== 'site' && p.group !== 'area', area: p.group !== 'area', role: p.group !== 'role', person: p.group !== 'person',
  };
  const template = ['30px', cols.date && '88px', '124px', cols.site && 'minmax(100px, 1fr)', cols.area && 'minmax(96px, 0.9fr)', cols.role && 'minmax(100px, 1fr)',
    cols.person && 'minmax(120px, 1.3fr)', '118px', '64px', '96px', 'minmax(100px, 1fr)', 'minmax(96px, 0.8fr)', '84px'].filter(Boolean).join(' ');

  const nOn = filterCount(lp, chosenRoles);
  const cleared = url({ ...offAll(FILTER_KEYS) });
  // The URL's other state for the filter form (week or day, site, grouping, sort, the strip's other filters).
  const state = new URL(url({ ...offAll(FILTER_KEYS), shift: undefined }), 'http://x').searchParams;
  const F = LIST_FILTERS;

  const chip = (f: '' | 'open' | StageCls, label: string, n: number, dot?: string) => {
    const on = chipOn(p, f);
    return (
      <Link key={f || 'all'} className={`q-tab${on ? ' on' : ''}`} href={url({ stage: f || undefined, limit: undefined })} scroll={false} aria-current={on ? 'page' : undefined}>
        {dot && <i className={`rb ${dot}`} aria-hidden="true" />}{label} <b>{n}</b>
      </Link>
    );
  };
  type Opt = { value: string; label: string };
  /** A heading's drop-down of tick boxes, in one or more groups; Apply (or Enter) filters. */
  const pop = (label: string, summary: string | null, groups: { name: string; title?: string; options: Opt[]; chosen: string[] }[], extra?: ReactNode) => (
    <details className="lst-pop rl-f lst-hf">
      <summary className={`rl-fsum${summary ? ' on' : ''}`} aria-label={`Filter ${label.toLowerCase()}`}>{summary ?? 'Any'}</summary>
      <div className="lst-pop-body rl-fbody">
        {extra}
        {groups.map(g => (
          <div key={g.name + (g.title ?? '')} className="rl-checks">
            {g.title && <b className="rl-group">{g.title}</b>}
            {g.options.map(o => (
              <label key={o.value} className="rl-check"><input type="checkbox" form={F} name={g.name} value={o.value} defaultChecked={g.chosen.includes(o.value)} /> {o.label}</label>
            ))}
            {g.options.length === 0 && <span className="muted small">Nothing to choose from this period.</span>}
          </div>
        ))}
        <button className="btn small" form={F}>Apply</button>
      </div>
    </details>
  );
  const chosen = (values: string[], options: Opt[]) => !values.length ? null : values.length === 1 ? options.find(o => o.value === values[0])?.label ?? values[0]! : `${values.length} chosen`;
  const head = (label: string, sort: ListSort | null, filter: ReactNode, extraCls = '') => (
    <span role="columnheader" className={`lst-h${extraCls}`}>
      {sort ? <Link href={url(sortOver(p, sort))} scroll={false} className="rl-sort" aria-label={`Sort by ${label.toLowerCase()}`}>{label}{sortMark(p, sort)}</Link> : <span className="rl-sort">{label}</span>}
      {filter}
    </span>
  );

  const dayOpts = (weekDays ?? []).map(d => ({ value: d, label: shortDay(d) }));
  const bandOpts = BANDS.map(b => ({ value: b, label: BAND_WORDS[b] }));
  const periodOpts = PERIODS.map(x => ({ value: x, label: PERIOD_WORDS[x] }));
  const timeChosen = (weekDays ? p.days.filter(d => weekDays.includes(d)).length : 0) + p.bands.length + p.periods.length;
  const timeF = pop('Time', timeChosen ? (timeChosen === 1 ? chosen([...p.days, ...p.bands, ...p.periods], [...dayOpts, ...bandOpts, ...periodOpts]) : `${timeChosen} chosen`) : null, [
    ...(weekDays ? [{ name: 'day', title: 'Day', options: dayOpts, chosen: p.days }] : []),
    { name: 'band', title: 'Starts', options: bandOpts, chosen: p.bands },
    { name: 'ap', title: 'Card letter', options: periodOpts, chosen: p.periods },
  ]);
  const siteOpts = [...sites.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  const siteF = pop(tw.one(T.site), chosen(p.sites, siteOpts), [{ name: 'fac', options: siteOpts, chosen: p.sites }]);
  const areaOpts = [...areas, ...chosenAreas.filter(a => !areas.includes(a))].map(a => ({ value: a, label: a === '-' ? `No ${tw.lower(T.area)}` : a }));
  const areaF = pop(tw.one(T.area), chosen(chosenAreas, areaOpts), [{ name: 'area', options: areaOpts, chosen: chosenAreas }]);
  const roleOpts = [...roles, ...chosenRoles.filter(r => !roles.includes(r))].map(r => ({ value: r, label: r }));
  const roleF = pop(tw.one(T.role), chosen(chosenRoles, roleOpts), [{ name: 'role', options: roleOpts, chosen: chosenRoles }]);
  const personOpts: Opt[] = [
    { value: '', label: 'Anyone' }, { value: 'none', label: 'Unfilled only' }, { value: 'agency', label: `${tw.one(T.agency)} people` },
    ...[...persons.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ value: id, label: name })),
  ];
  const personSummary = [p.who && `“${p.who}”`, p.person && (personOpts.find(o => o.value === p.person)?.label ?? persons.get(p.person) ?? 'One person')].filter(Boolean).join(' · ') || null;
  const personF = (
    <details className="lst-pop rl-f lst-hf">
      <summary className={`rl-fsum${personSummary ? ' on' : ''}`} aria-label={`Filter ${tw.lower(T.worker)}`}>{personSummary ?? 'Any'}</summary>
      <div className="lst-pop-body rl-fbody">
        <label>Name<input type="search" form={F} name="who" defaultValue={p.who} maxLength={80} placeholder="Part of a name" /></label>
        <label>Show
          <select form={F} name="person" defaultValue={p.person}>
            {personOpts.map(o => <option key={o.value || 'any'} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <button className="btn small" form={F}>Apply</button>
      </div>
    </details>
  );
  const stageOpts = STAGE_ORDER.map(c => ({ value: c, label: STAGE_WORDS[c] }));
  const stageF = pop('Stage', p.stages.length ? chosen(p.stages, stageOpts) : null, [{ name: 'stage', options: stageOpts, chosen: p.stages }],
    <span className="muted small">None ticked = everything but cancelled.</span>);
  const lenOpts = LENGTHS.map(x => ({ value: x, label: LENGTH_WORDS[x] }));
  const hoursF = pop('Hours', chosen(p.lengths, lenOpts), [{ name: 'len', options: lenOpts, chosen: p.lengths }]);
  const markOpts: Opt[] = [
    { value: 'gender', label: 'Gender requested (F/M)' }, { value: 'vehicle', label: `Vehicle (${letters.vehicle})` },
    { value: 'equipment', label: `${tw.one(T.equipment)} (${letters.equipment})` }, { value: 'items', label: `${tw.many(T.item)} (${letters.items})` },
    { value: 'duty', label: `Duties (${letters.duty})` }, { value: 'template', label: `Usual person (${letters.template})` },
    { value: 'request', label: `Request (${letters.request})` }, { value: 'ringed', label: 'Ringed: doesn’t fit' },
  ];
  const lettersF = pop('Letters', chosen(p.marks, markOpts), [{ name: 'mk', options: markOpts, chosen: p.marks }]);
  const tlOpts = TLINES.map(x => ({ value: x, label: TLINE_WORDS[x] }));
  const pstOpts = pstages.size || p.pstages.length
    ? [...[...pstages.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })), { value: 'none', label: 'Not from a stage' }]
    : [];
  const tlineF = pop(`${letters.template} line`, (p.tlines.length + p.pstages.length) > 1 ? `${p.tlines.length + p.pstages.length} chosen` : chosen([...p.tlines, ...p.pstages], [...tlOpts, ...pstOpts]), [
    { name: 'tl', title: pstOpts.length ? 'Usual person' : undefined, options: tlOpts, chosen: p.tlines },
    ...(pstOpts.length ? [{ name: 'pst', title: 'Project stage', options: pstOpts, chosen: p.pstages }] : []),
  ]);
  const warnOpts = WARNS.map(x => ({ value: x, label: WARN_WORDS[x] }));
  const warnF = pop('Warnings', chosen(p.warns, warnOpts), [{ name: 'warn', options: warnOpts, chosen: p.warns }]);
  // A column hidden by the grouping keeps its filter on the bar above.
  const barFilters: { label: string; node: ReactNode }[] = [
    ...(!cols.site && allSites ? [{ label: tw.one(T.site), node: siteF }] : []),
    ...(!cols.area ? [{ label: tw.one(T.area), node: areaF }] : []),
    ...(!cols.role ? [{ label: tw.one(T.role), node: roleF }] : []),
    ...(!cols.person ? [{ label: tw.one(T.worker), node: personF }] : []),
  ];

  const roleIn = roleEditColumn(p.group);
  const shiftW = tw.lower(T.shift);
  /** Day, times and break, like the shift panel's form; the API refuses what the person or equipment on it can't do. */
  const timesForm = (s: ListRowShift, label: string) => editPop(`lst-t-${s.id}`, 'day and times', label, (
    <form action={setTimes.bind(null, s.id)} className="lst-edform">
      <input type="hidden" name="back" value={here} />
      <label>Day<input type="date" name="date" defaultValue={s.localDate} required /></label>
      <label>Start<input type="time" name="startTime" defaultValue={s.localStart} required /></label>
      <label>End<input type="time" name="endTime" defaultValue={s.localEnd} required /></label>
      <label>Break (min)<input type="number" name="breakMinutes" min={0} max={240} step={5} defaultValue={s.breakMinutes ?? 0} /></label>
      <button className="btn small">Save</button>
      <span className="muted small">An end before the start runs overnight. Whoever is on the {shiftW} must still be able to work the new times.</span>
    </form>
  ));
  const roleForm = (s: ListRowShift, label: string) => editPop(`lst-r-${s.id}`, `${tw.lower(T.role)} or ${tw.lower(T.area)}`, label, (
    <form action={setRole.bind(null, s.id)} className="lst-edform">
      <input type="hidden" name="back" value={here} />
      <label>{tw.one(T.role)}<input name="role" defaultValue={s.role} maxLength={60} list="known-roles" required /></label>
      <label>{tw.one(T.area)}
        <select name="areaId" defaultValue={s.areaId ?? ''}>
          <option value="">No {tw.lower(T.area)}</option>
          {areaChoices(edit?.areas.get(s.facilityId), s).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <button className="btn small">Save</button>
      {s.workerId && <span className="muted small">Refused if the person on it can&apos;t work the new {tw.lower(T.role)}.</span>}
    </form>
  ));

  return (
    <div className="lst">
      <div className="lst-filters">
        <form id={F} method="get" action="/roster" className="q-selects" role="search">
          {[...state.entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="sr-only" htmlFor="lst-q">Search</label>
          <input id="lst-q" name="q" type="search" defaultValue={p.q} placeholder={`Search names, ${tw.lower(T.role, true)}, ${tw.lower(T.area, true)}…`} className="lst-search" />
          <button className="btn small secondary">Search</button>
        </form>
        {barFilters.map(f => <span key={f.label} className="lst-barf"><span className="muted small">{f.label}</span>{f.node}</span>)}
        {nOn > 0 && <Link href={cleared} className="small" scroll={false}>Clear filters</Link>}
        <nav className="q-chips lst-groupby" aria-label="Group by">
          <span className="muted small">Group by</span>
          {GROUP_BYS.map(g => (
            <Link key={g} className={`q-chip${p.group === g ? ' on' : ''}`} href={url({ group: g === 'date' ? undefined : g, limit: undefined })} scroll={false} aria-current={p.group === g ? 'true' : undefined}>
              {groupWord(g, tw)}
            </Link>
          ))}
        </nav>
        <Link className="small lst-striplink" href={url({ strip: p.strip ? undefined : '1' })} scroll={false}
          title={p.strip ? undefined : `Drag ${tw.lower(T.worker, true)} onto unfilled rows, and ${tw.lower(T.equipment)} or ${tw.lower(T.item, true)} onto any row`}>
          {p.strip ? `Hide ${tw.lower(T.worker, true)} to drag` : `Show ${tw.lower(T.worker, true)} to drag`}
        </Link>
      </div>
      <nav className="q-tabs" aria-label="Stage">
        {chip('', 'All', tally[''])}
        {chip('open', 'Unfilled only', tally.open)}
        {STAGE_ORDER.filter(c => c !== 'accepted' || tally.accepted).map(c => chip(c, STAGE_WORDS[c], tally[c], c))}
      </nav>

      <ListTools back={here} closeHref={closeHref} people={people} duties={duties}
        labels={{ shift: shiftWord, shifts: shiftsWord, person: tw.lower(T.worker), people: tw.lower(T.worker, true), bank: tw.lower(T.bank), client: tw.one(T.client) }}>
        <input type="checkbox" id="lst-ftoggle" className="lst-ftoggle sr-only" />
        <div className="lst-fbar">
          <label htmlFor="lst-ftoggle" className="btn small secondary">Filters{nOn ? ` (${nOn})` : ''}</label>
          {nOn > 0 && <Link href={cleared} className="small" scroll={false}>Clear filters</Link>}
        </div>
        <section className="q-list lst-list" aria-label={tw.many(T.shift)}>
          <div className="q-scroll lst-scroll">
            <div className="lst-table" role="table" style={{ ['--lst-cols' as string]: template }}>
              <div className="lst-row lst-head" role="row">
                <span role="columnheader"><span className="sr-only">Tick</span></span>
                {cols.date && head('Date', 'time', null)}
                {head('Time', 'time', timeF)}
                {cols.site && head(tw.one(T.site), 'site', siteF)}
                {cols.area && head(tw.one(T.area), 'area', areaF)}
                {cols.role && head(tw.one(T.role), 'role', roleF)}
                {cols.person && head(tw.one(T.worker), 'person', personF)}
                {head('Stage', 'stage', stageF)}
                {head('Hours', 'hours', hoursF, ' num')}
                {head('Letters', null, lettersF)}
                {head(`${letters.template} line`, null, tlineF)}
                {head('Warnings', null, warnF)}
                <span role="columnheader"><span className="sr-only">Actions</span></span>
              </div>
              {groups.length === 0 && (
                <p className="q-empty">{shifts.length === 0 ? `No ${shiftsWord} this period. Use Add ${shiftsWord} above.` : `No ${shiftsWord} match. `}
                  {shifts.length > 0 && <Link href={cleared} scroll={false}>Clear filters</Link>}</p>
              )}
              {paged.groups.map(g => (
                <div key={g.key} className="lst-group" data-group={`${p.group}:${g.key}`} role="rowgroup">
                  <div className="lst-ghead" role="row">
                    <span className="lst-tick">{g.shown.length > 0 && <input type="checkbox" data-gall={g.key} aria-label={`Tick every ${shiftWord} shown in ${g.title}`} />}</span>
                    <button type="button" data-gtoggle aria-expanded="true" className="lst-gbtn">
                      <span className="lst-caret" aria-hidden="true" /><b>{g.title}</b> <span className="lst-gline">{groupLine(g, count)}</span>
                    </button>
                  </div>
                  {g.shown.map(s => row(s, g.key))}
                  {g.notShown > 0 && (
                    <div className="lst-more" role="row">{g.notShown} more in this group. <Link href={url({ limit: String(Math.min(LIST_MAX, p.limit + 1000)) })} scroll={false}>Show more</Link></div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="q-foot lst-foot">
            <span>{rows.length === shifts.length ? count(rows.length) : `${rows.length} of ${count(shifts.length)}`}{paged.hidden > 0 ? ` (first ${rows.length - paged.hidden} shown)` : ''}</span>
            {paged.hidden > 0 && <Link href={url({ limit: String(Math.min(LIST_MAX, p.limit + 1000)) })} scroll={false}>Show {Math.min(1000, paged.hidden)} more</Link>}
            {paged.hidden > 0 && p.limit + 1000 < Math.min(LIST_MAX, rows.length) && <Link href={url({ limit: String(LIST_MAX) })} scroll={false}>Show all</Link>}
            {p.limit > LIST_PAGE && <Link href={url({ limit: undefined })} scroll={false}>Show fewer</Link>}
            <span className="muted">J/K move · Enter opens · X ticks · Esc closes</span>
          </div>
        </section>
      </ListTools>
    </div>
  );

  function row(s: ListRowShift, groupKey: string) {
    const st = stageClass(s);
    const sel = s.id === selectedId;
    const cancelled = st === 'cancelled';
    const marks = facts.get(s.id)?.marksList ?? [];
    const warn: { key: string; text: string; title: string; bad?: boolean }[] = [];
    if (!cancelled) {
      const b = blocked.get(s.id);
      if (b) warn.push({ key: 'b', text: 'Blocked', title: b, bad: true });
      const gap = gaps.get(s.id);
      if (gap) warn.push({ key: 'c', text: 'Cover gap', title: gap });
      for (const m of marks.filter(m => m.cls.includes('warn'))) {
        warn.push({ key: m.key, text: m.key === 'g' ? 'Gender' : m.key === 't' ? 'Usual away' : 'Request', title: m.title });
      }
    }
    const t = tLines(s);
    const waiting = !cancelled && s.status === 'assigned' && !!s.workerId;
    const canAct = !refused.has(s.facilityId);
    const label = `${shortDay(s.localDate)} ${s.localStart}–${s.localEnd} ${s.role}`;
    const editable = !!edit && rowEditable(s, edit.now, { canEdit: edit.canEdit, refused });
    const editRole = editable && !s.equipmentOnly;
    return (
      <div key={s.id} className={`lst-row st-${st}${sel ? ' sel' : ''}`} role="row" data-lrowbox
        // A drop target like the cards (7 Nov): a person from the strip onto an open row, equipment or an item onto any live one.
        data-shift={s.id} data-date={s.localDate} data-start={s.localStart} data-href={url({ shift: s.id })}
        data-needs-person={!cancelled && !s.equipmentOnly && !s.workerId ? '1' : '0'} data-takes-equipment={!cancelled ? '1' : '0'}
        data-worker={s.workerId ?? ''} data-worker-name={s.workerName ?? ''} data-equipment-only={s.equipmentOnly ? '1' : '0'}>
        <span className="lst-tick" role="cell">
          {!cancelled && (
            <input type="checkbox" form={BULK_FORM} name="pick" value={pickValue(s)} data-pick data-g={groupKey}
              data-open={needsPerson(s) ? '1' : '0'} data-waiting={waiting ? '1' : '0'} data-client={s.clientId ? '1' : '0'} aria-label={`Tick ${label}`} />
          )}
        </span>
        {cols.date && <span role="cell" className="lst-date">{shortDay(s.localDate)}</span>}
        <span role="cell" className="lst-time">
          <a href={url({ shift: s.id })} data-lrow aria-current={sel ? 'true' : undefined} title={`Open ${label}`}>{s.localStart}–{s.localEnd}</a>
          {editable && timesForm(s, label)}
        </span>
        {cols.site && <span role="cell" className="cut">{s.facilityName}</span>}
        {cols.area && (editRole && roleIn === 'area'
          ? <span role="cell" className="lst-edcell"><span className="cut">{s.areaName ?? <span className="muted">–</span>}</span>{roleForm(s, label)}</span>
          : <span role="cell" className="cut">{s.areaName ?? <span className="muted">–</span>}</span>)}
        {cols.role && (editRole && roleIn === 'role'
          ? <span role="cell" className="lst-edcell"><span className="cut">{s.role}</span>{roleForm(s, label)}</span>
          : <span role="cell" className="cut">{s.role}</span>)}
        {cols.person && (
          <span role="cell" className={`cut${s.workerName ? '' : ' muted'}`}>
            {s.equipmentOnly ? `${tw.one(T.equipment)} only` : s.workerName ?? (s.pulledOutName ? `Unfilled (${s.pulledOutName} pulled out)` : 'Unfilled')}
            {s.agencyName && <span className="muted"> · {s.agencyName}{s.agencyUnchecked ? `, ${UNCHECKED}` : ''}</span>}
          </span>
        )}
        <span role="cell"><span className={`lst-pill st-${st}`}><i className={`rb ${st}`} aria-hidden="true" />{stageLabel(s)}</span></span>
        <span role="cell" className="num">{fmtHours(s.hours)}</span>
        <span role="cell" className="lst-mk">{letterCol(s)}</span>
        <span role="cell" className="cut small">
          {t.map(l => <span key={l.tone} className={`tline tl-${l.tone}`} title={l.title}>{l.text}</span>)}
          {projectStageLine(s) && <span className="tline pstage">{projectStageLine(s)}</span>}
        </span>
        <span role="cell" className="lst-warn">
          {warn.map(w => <span key={w.key} className={`lst-w${w.bad ? ' bad' : ''}`} title={w.title}>{w.text}</span>)}
        </span>
        <span role="cell" className="lst-act">
          {waiting && canAct && (
            <form action={confirm.bind(null, s.id)}>
              <input type="hidden" name="back" value={here} />
              <button className="btn small secondary" title={`Confirm ${label}`}>{s.agencyName ? 'Approve' : 'Confirm'}</button>
            </form>
          )}
        </span>
      </div>
    );
  }
}

/**
 * A small dialog for an inline change. It uses the browser's popover (top layer), so it isn't cut off by the list's
 * scrolling box; Esc or a click outside closes it.
 */
function editPop(id: string, what: string, label: string, body: ReactNode) {
  return (
    <>
      <button type="button" className="lst-edbtn" popoverTarget={id} aria-label={`Change ${what} of ${label}`} title={`Change ${what}`}><span aria-hidden="true">✎</span></button>
      <div popover="auto" id={id} className="lst-edpop" role="dialog" aria-label={`Change ${what}`}>
        <b>Change {what}</b>
        <span className="muted small">{label}</span>
        {body}
      </div>
    </>
  );
}

const needsPerson = (s: ListRowShift) => s.status === 'open' && !s.equipmentOnly;

function groupWord(g: ListGroupBy, tw: Words): string {
  return { date: 'Date', site: tw.one(T.site), area: tw.one(T.area), person: tw.one(T.worker), role: tw.one(T.role), stage: 'Stage' }[g];
}
