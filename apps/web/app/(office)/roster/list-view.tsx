import Link from 'next/link';
import type { ReactNode } from 'react';
import { T, type Words } from '../../../lib/terms';
import type { MarkerLetters } from '../../../lib/marker-letters';
import {
  GROUP_BYS, LIST_MAX, LIST_PAGE, STAGE_ORDER, STAGE_WORDS, filterShifts, groupLine, groupShifts, pageGroups, pickValue, stageClass, stageTally,
  type ListGroupBy, type ListParams, type ListShift, type StageFilter,
} from '../../../lib/roster-list';
import { UNCHECKED } from '../../../lib/outside-agency';
import { confirm } from './actions';
import { AutoSelect, BULK_FORM, ListTools } from './list-tools';
import { requestsFor, shiftMarkers, tLines, type DayRequest, type MarkerShift } from './view';

/** A roster shift as the list needs it (`GET /roster` rows). */
export type ListRowShift = ListShift & MarkerShift & { breakMinutes?: number; agencyUnchecked?: boolean; clientId?: string | null; equipment?: { name: string; vehicle?: boolean }[] };

const fmtHours = (n: number) => (Math.round(n * 10) / 10).toString();
const shortDay = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)).replace(',', '');
const longDay = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/**
 * The roster's List view (David and Steve, 4 Nov): the same shifts as the cards, one compact row each, grouped and
 * filtered from the URL, with tick boxes for acting on several at once. A row opens the same shift panel as a card.
 */
export function ListView({ shifts, p, role, tw, letters, dayRequests, url, here, selectedId, allSites, people, duties, blocked, gaps, refused, stageLabel, letterCol, closeHref }: {
  shifts: ListRowShift[]; p: ListParams; role: string; tw: Words; letters: MarkerLetters; dayRequests: DayRequest[];
  url: (over: Record<string, string | undefined>) => string; here: string; selectedId: string | null; allSites: boolean;
  people: { id: string; name: string }[]; duties: { id: string; name: string }[];
  /** Hard blocks for the person or equipment on a shift (Needs attention, next 7 days), by shift. */
  blocked: Map<string, string>;
  /** Cover gaps by the shift they were found on. */
  gaps: Map<string, string>;
  /** Sites whose week this person can't change (after-publishing rule): no quick actions there, the panel asks instead. */
  refused: Set<string>;
  stageLabel: (s: ListRowShift) => string; letterCol: (s: ListRowShift) => ReactNode; closeHref: string | null;
}) {
  const shiftWord = tw.lower(T.shift), shiftsWord = tw.lower(T.shift, true);
  const count = (n: number) => tw.count(n, T.shift);
  // Chips count what the other filters leave; the rows also apply the stage.
  const beforeStage = filterShifts(shifts, p, role, 'stage');
  const tally = stageTally(beforeStage);
  const rows = filterShifts(beforeStage, p, '', undefined);
  const groups = groupShifts(rows, p.group, { dateLabel: longDay, noArea: `No ${tw.lower(T.area)}`, unfilled: 'Unfilled', allSites });
  const paged = pageGroups(groups, p.limit);
  const cols = {
    date: p.group !== 'date', site: allSites && p.group !== 'site' && p.group !== 'area', area: p.group !== 'area', role: p.group !== 'role', person: p.group !== 'person',
  };
  const template = ['30px', cols.date && '88px', '92px', cols.site && 'minmax(90px, 1fr)', cols.area && 'minmax(80px, 0.9fr)', cols.role && 'minmax(90px, 1fr)',
    cols.person && 'minmax(110px, 1.3fr)', '112px', '42px', '92px', 'minmax(90px, 1fr)', 'minmax(80px, 0.8fr)', '84px'].filter(Boolean).join(' ');

  // Choices for the filters, from the period's shifts (so a contractor's "Work areas" list stays theirs).
  const roles = [...new Set(shifts.filter(s => !s.equipmentOnly).map(s => s.role))].sort();
  const areas = [...new Set(shifts.map(s => s.areaName ?? '-'))].sort((a, b) => (a === '-' ? 1 : b === '-' ? -1 : a.localeCompare(b)));
  const persons = new Map<string, string>();
  for (const s of shifts) if (s.workerId && s.workerName) persons.set(s.workerId, s.workerName);
  const keep = { layout: 'list', group: p.group === 'date' ? undefined : p.group };
  const anyFilter = !!(p.q || p.stage || p.area || p.person || role);
  const hidden = (k: string, v: string | undefined) => v ? <input type="hidden" name={k} value={v} /> : null;
  // The URL's other state, for the filter form (week or day, site, grouping).
  const state = new URL(url({ ...keep, q: undefined, area: undefined, person: undefined, role: undefined, limit: undefined, shift: undefined }), 'http://x').searchParams;

  const chip = (f: StageFilter, label: string, n: number, dot?: string) => (
    <Link key={f || 'all'} className={`q-tab${p.stage === f ? ' on' : ''}`} href={url({ stage: f || undefined, limit: undefined })} scroll={false} aria-current={p.stage === f ? 'page' : undefined}>
      {dot && <i className={`rb ${dot}`} aria-hidden="true" />}{label} <b>{n}</b>
    </Link>
  );

  return (
    <div className="lst">
      <div className="lst-filters">
        <form method="get" action="/roster" className="q-selects" role="search">
          {[...state.entries()].map(([k, v]) => <span key={k}>{hidden(k, v)}</span>)}
          <label className="sr-only" htmlFor="lst-q">Search</label>
          <input id="lst-q" name="q" type="search" defaultValue={p.q} placeholder={`Search names, ${tw.lower(T.role, true)}, ${tw.lower(T.area, true)}…`} className="lst-search" />
          <AutoSelect name="role" value={role} label={tw.one(T.role)} options={[{ value: '', label: `Every ${tw.lower(T.role)}` }, ...(role && !roles.includes(role) ? [role] : roles).map(r => ({ value: r, label: r }))]} />
          <AutoSelect name="area" value={p.area} label={tw.one(T.area)} options={[{ value: '', label: `Every ${tw.lower(T.area)}` }, ...areas.map(a => ({ value: a, label: a === '-' ? `No ${tw.lower(T.area)}` : a }))]} />
          <AutoSelect name="person" value={p.person} label={tw.one(T.worker)} options={[
            { value: '', label: `Every ${tw.lower(T.worker)}` }, { value: 'none', label: 'Nobody on it yet' },
            ...[...persons.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ value: id, label: name })),
          ]} />
          <button className="btn small secondary">Search</button>
          {anyFilter && <Link href={url({ q: undefined, stage: undefined, area: undefined, person: undefined, role: undefined, limit: undefined })} className="small" scroll={false}>Clear filters</Link>}
        </form>
        <nav className="q-chips lst-groupby" aria-label="Group by">
          <span className="muted small">Group by</span>
          {GROUP_BYS.map(g => (
            <Link key={g} className={`q-chip${p.group === g ? ' on' : ''}`} href={url({ group: g === 'date' ? undefined : g, limit: undefined })} scroll={false} aria-current={p.group === g ? 'true' : undefined}>
              {groupWord(g, tw)}
            </Link>
          ))}
        </nav>
      </div>
      <nav className="q-tabs" aria-label="Stage">
        {chip('', 'All', tally[''])}
        {chip('open', 'Unfilled only', tally.open)}
        {STAGE_ORDER.filter(c => c !== 'accepted' || tally.accepted).map(c => chip(c, STAGE_WORDS[c], tally[c], c))}
      </nav>

      <ListTools back={here} closeHref={closeHref} people={people} duties={duties}
        labels={{ shift: shiftWord, shifts: shiftsWord, person: tw.lower(T.worker), people: tw.lower(T.worker, true), bank: tw.lower(T.bank), client: tw.one(T.client) }}>
        <section className="q-list lst-list" aria-label={tw.many(T.shift)}>
          <div className="q-scroll lst-scroll">
            <div className="lst-table" role="table" style={{ ['--lst-cols' as string]: template }}>
              <div className="lst-row lst-head" role="row">
                <span role="columnheader"><span className="sr-only">Tick</span></span>
                {cols.date && <span role="columnheader">Date</span>}
                <span role="columnheader">Time</span>
                {cols.site && <span role="columnheader">{tw.one(T.site)}</span>}
                {cols.area && <span role="columnheader">{tw.one(T.area)}</span>}
                {cols.role && <span role="columnheader">{tw.one(T.role)}</span>}
                {cols.person && <span role="columnheader">{tw.one(T.worker)}</span>}
                <span role="columnheader">Stage</span>
                <span role="columnheader" className="num">Hours</span>
                <span role="columnheader">Letters</span>
                <span role="columnheader" title="Who usually works it, or who it covers">{letters.template} line</span>
                <span role="columnheader">Warnings</span>
                <span role="columnheader"><span className="sr-only">Actions</span></span>
              </div>
              {groups.length === 0 && (
                <p className="q-empty">{shifts.length === 0 ? `No ${shiftsWord} this period. Use Add ${shiftsWord} above.` : `No ${shiftsWord} match. `}
                  {shifts.length > 0 && <Link href={url({ q: undefined, stage: undefined, area: undefined, person: undefined, role: undefined })} scroll={false}>Clear filters</Link>}</p>
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
    const marks = cancelled ? [] : shiftMarkers({ ...s, requests: requestsFor(s, dayRequests) }, letters);
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
    return (
      <div key={s.id} className={`lst-row st-${st}${sel ? ' sel' : ''}`} role="row" data-lrowbox>
        <span className="lst-tick" role="cell">
          {!cancelled && (
            <input type="checkbox" form={BULK_FORM} name="pick" value={pickValue(s)} data-pick data-g={groupKey}
              data-open={needsPerson(s) ? '1' : '0'} data-waiting={waiting ? '1' : '0'} data-client={s.clientId ? '1' : '0'} aria-label={`Tick ${label}`} />
          )}
        </span>
        {cols.date && <span role="cell" className="lst-date">{shortDay(s.localDate)}</span>}
        <span role="cell" className="lst-time">
          <a href={url({ shift: s.id })} data-lrow aria-current={sel ? 'true' : undefined} title={`Open ${label}`}>{s.localStart}–{s.localEnd}</a>
        </span>
        {cols.site && <span role="cell" className="cut">{s.facilityName}</span>}
        {cols.area && <span role="cell" className="cut">{s.areaName ?? <span className="muted">–</span>}</span>}
        {cols.role && <span role="cell" className="cut">{s.role}</span>}
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

const needsPerson = (s: ListRowShift) => s.status === 'open' && !s.equipmentOnly;

function groupWord(g: ListGroupBy, tw: Words): string {
  return { date: 'Date', site: tw.one(T.site), area: tw.one(T.area), person: tw.one(T.worker), role: tw.one(T.role), stage: 'Stage' }[g];
}
