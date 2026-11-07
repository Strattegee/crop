import Link from 'next/link';
import type { ReactNode } from 'react';
import { needsHeadings, type IndustryGroup } from '../../../lib/industry-groups';
import {
  DOCS_FILTERS, DOCS_LABEL, KMS, LIST_STAGES, RL_MAX, RL_PAGE, SOURCE_LABEL, STAGE_LABEL, WAITING_FILTERS, WAITING_LABEL, WORK_LABEL, WORK_TYPES,
  ACTIVE_STAGES, anyFilter, clearedHref, docsLine, docsPercent, pickValue, placeLine, recruitHref, shortDate, showingLine, sortHref, sortMark,
  stageChips, waitLine, workLine, type Docs, type RecruitParams, type SortKey,
} from '../../../lib/recruitment-list';
import { T, type Words } from '../../../lib/terms';
import { ColumnFilterForm } from '../column-filter-form';
import { ChoiceList, ColumnMulti, ColumnPop, ColumnSelect, type Choice } from '../column-filters';
import { RecruitTools, RL_BULK, RL_FILTERS } from './list-tools';

export type ListRow = {
  id: string; firstName: string; lastName: string; preferredName: string | null; email: string | null; phone: string | null;
  roles: string[]; stage: string; appliedAt: string | null; movedAt: string | null; days: number | null; source: 'online' | 'office';
  workTypes: string[]; suburb: string | null; region: string | null; postcode: string | null; docs: Docs; distanceKm?: number | null;
  onboardingId?: string | null; needsAction: boolean; progress: { done: number; total: number; ready: boolean } | null;
};
export type ListData = {
  rows: ListRow[]; total: number; more: number; counts: Record<string, number>; states: { value: string; count: number }[];
  offices: { id: string; name: string }[]; km: number; today: string;
};

const COLS = '30px minmax(150px, 1.6fr) 104px minmax(90px, 1fr) 96px minmax(110px, 1fr) 124px minmax(130px, 1.2fr) 112px';

/**
 * The recruitment list (David, 5 Nov): one row per person, each column with its filter in the heading row (state in
 * the URL), stage chips above, tick boxes for acting on many at once. Filtering, counting and paging happen in the API.
 */
export function RecruitList({ data, p, tw, zone, roleGroups, sites, canOnboard, mobileShow }: {
  data: ListData; p: RecruitParams; tw: Words; zone: string; roleGroups: IndustryGroup<{ name: string }>[];
  sites: { id: string; name: string }[]; canOnboard: boolean; mobileShow?: boolean;
}) {
  const here = recruitHref(p, { limit: p.limit });
  const shownStages = p.stages.length ? p.stages : ACTIVE_STAGES;
  const peopleCount = (n: number) => `${n.toLocaleString('en-AU')} ${n === 1 ? 'person' : 'people'}`;
  const filtersOn = [p.roles.length, p.work.length, p.states.length + (p.place ? 1 : 0) + (p.office ? 1 : 0) + (p.near ? 1 : 0), p.docs ? 1 : 0, p.waiting ? 1 : 0, p.source ? 1 : 0, p.q ? 1 : 0]
    .reduce((a, b) => a + b, 0);

  const sortLink = (key: SortKey, label: string) => (
    <Link href={sortHref(p, key)} className="rl-sort" scroll={false} aria-label={`Sort by ${label.toLowerCase()}`}>{label}{sortMark(p, key)}</Link>
  );
  const multi = (name: string, label: string, chosen: string[], options: Choice[]) => (
    <ColumnMulti name={name} label={label} chosen={chosen} options={options} any={`Any ${label.toLowerCase()}`} />
  );
  const select = (name: string, label: string, value: string, options: Choice[]) => (
    <ColumnSelect name={name} label={label} value={value} options={options} />
  );

  const roleOptions = roleGroups.flatMap(g => g.items.map(r => ({ value: r.name, label: r.name, group: needsHeadings(roleGroups) ? g.label : undefined })));
  for (const r of p.roles) if (!roleOptions.some(o => o.value === r)) roleOptions.push({ value: r, label: r, group: undefined });
  const stateOptions: Choice[] = data.states.map(s => ({ value: s.value, label: `${s.value} (${s.count})`, group: 'State' }));
  for (const s of p.states) if (!stateOptions.some(o => o.value === s)) stateOptions.push({ value: s, label: s, group: 'State' });
  const where = [...p.states, p.place, data.offices.find(o => o.id === p.office)?.name, p.near ? `near ${sites.find(s => s.id === p.near)?.name ?? tw.lower(T.site)}` : ''].filter(Boolean);

  return (
    <div className="rl">
      <nav className="q-tabs" aria-label="Stage">
        {stageChips(p, data.counts).map(c => (
          <Link key={c.key} href={c.href} className={`q-tab${c.on ? ' on' : ''}`} scroll={false} aria-current={c.on ? 'page' : undefined}>
            {c.label} <b>{c.count.toLocaleString('en-AU')}</b>
          </Link>
        ))}
      </nav>

      <RecruitTools back={here} canOnboard={canOnboard} rosterWord={tw.lower(T.roster)}>
        <input type="checkbox" id="rl-ftoggle" className="rl-ftoggle sr-only" defaultChecked={mobileShow} />
        <div className="rl-bar">
          <label htmlFor="rl-ftoggle" className="btn small secondary rl-fbtn">Filters{filtersOn ? ` (${filtersOn})` : ''}</label>
          <span className="muted small">{showingLine(data.rows.length, data.total, peopleCount)}</span>
          {anyFilter(p) && <Link href={clearedHref(p)} className="small" scroll={false}>Clear filters</Link>}
        </div>
        <section className="q-list rl-list" aria-label="People in recruitment">
          <div className="rl-table" role="table" style={{ ['--rl-cols' as string]: COLS }}>
            <ColumnFilterForm id={RL_FILTERS} action="/recruitment" className="rl-row rl-head" label="Filter the people in recruitment">
              {p.sort !== 'default' && <input type="hidden" name="sort" value={`${p.desc ? '-' : ''}${p.sort}`} />}
              <span role="columnheader" className="rl-h rl-tick">
                {data.rows.length > 0 && <input type="checkbox" data-pickall aria-label="Tick everyone on this page" form="rl-none" />}
              </span>
              <span role="columnheader" className="rl-h" data-col="Name">
                {sortLink('name', 'Name')}
                <input type="search" name="q" defaultValue={p.q} placeholder="Name, email or mobile" aria-label="Search names, emails and mobiles" className="rl-text" />
              </span>
              <span role="columnheader" className="rl-h">
                {sortLink('stage', 'Stage')}
                {multi('stage', 'Stage', shownStages, LIST_STAGES.map(s => ({ value: s, label: STAGE_LABEL[s] })))}
              </span>
              <span role="columnheader" className="rl-h">
                <span className="rl-sort">{tw.many(T.role)}</span>
                {multi('role', tw.one(T.role), p.roles, roleOptions)}
              </span>
              <span role="columnheader" className="rl-h">
                <span className="rl-sort" title="The kind of work they want">Position</span>
                {multi('work', 'Position', p.work, WORK_TYPES.map(w => ({ value: w, label: WORK_LABEL[w]! })))}
              </span>
              <span role="columnheader" className="rl-h">
                {sortLink('region', 'Region')}
                <ColumnPop summary={where.length ? where.join(', ') : 'Anywhere'} on={where.length > 0} label="Region">
                  {stateOptions.length > 0 && <ChoiceList name="state" chosen={p.states} options={stateOptions} />}
                  <label>Suburb or postcode<input name="place" defaultValue={p.place} maxLength={60} /></label>
                  {data.offices.length > 0 && (
                    <label>Near an office&apos;s {tw.lower(T.site, true)}
                      <select name="office" defaultValue={p.office}>
                        <option value="">Any office</option>
                        {data.offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </label>
                  )}
                  {sites.length > 0 && (
                    <label>Near {tw.lower(T.site)}
                      <select name="near" defaultValue={p.near}>
                        <option value="">Any {tw.lower(T.site)}</option>
                        {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </label>
                  )}
                  {(sites.length > 0 || data.offices.length > 0) && (
                    <label>Within
                      <select name="km" defaultValue={p.km || String(data.km)}>
                        {[...new Set([...KMS, data.km])].sort((a, b) => a - b).map(k => <option key={k} value={k}>{k} km of home</option>)}
                      </select>
                    </label>
                  )}
                </ColumnPop>
              </span>
              <span role="columnheader" className="rl-h">
                {sortLink('docs', 'Documents')}
                {select('docs', 'Documents', p.docs, DOCS_FILTERS.map(d => ({ value: d, label: DOCS_LABEL[d]! })))}
              </span>
              <span role="columnheader" className="rl-h">
                {sortLink('days', 'Progress')}
                {select('waiting', 'Progress', p.waiting, WAITING_FILTERS.map(w => ({ value: w, label: WAITING_LABEL[w]! })))}
              </span>
              <span role="columnheader" className="rl-h">
                {sortLink('applied', 'Applied')}
                {select('source', 'Source', p.source, Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label })))}
              </span>
              <button className="sr-only">Apply filters</button>
            </ColumnFilterForm>

            {data.rows.length === 0 && (
              <p className="q-empty">Nobody matches. {anyFilter(p) && <Link href={clearedHref(p)} scroll={false}>Clear filters</Link>}</p>
            )}
            {data.rows.map(r => row(r))}
          </div>
          <div className="q-foot">
            <span>{showingLine(data.rows.length, data.total, peopleCount)}</span>
            {data.more > 0 && <Link href={recruitHref(p, { limit: Math.min(RL_MAX, p.limit + RL_PAGE) })} scroll={false}>Show {Math.min(RL_PAGE, data.more)} more</Link>}
            {data.more > RL_PAGE && <Link href={recruitHref(p, { limit: Math.min(RL_MAX, data.total) })} scroll={false}>Show all</Link>}
            {p.limit > RL_PAGE && <Link href={recruitHref(p)} scroll={false}>Show fewer</Link>}
            <span className="muted q-foot-count">J/K move · Enter opens · X ticks · Esc clears</span>
          </div>
        </section>
      </RecruitTools>
    </div>
  );

  function row(r: ListRow): ReactNode {
    const name = `${r.preferredName || r.firstName} ${r.lastName}`;
    return (
      <div key={r.id} className={`rl-row${r.needsAction ? ' action' : ''}`} role="row" data-rlrow>
        <span role="cell" className="rl-tick">
          <input type="checkbox" form={RL_BULK} name="pick" value={pickValue(r)} data-pick aria-label={`Tick ${name}`} />
        </span>
        <span role="cell" className="rl-name">
          <a href={`/workers/${r.id}`} data-lrow className="cut">{name}</a>
          {r.source === 'online' && <span className="badge neutral" title="They applied through your online form">Applied online</span>}
          {r.email && <span className="muted small cut">{r.email}</span>}
        </span>
        <span role="cell" data-label="Stage"><span className={`rl-stage rs-${r.stage}`}>{STAGE_LABEL[r.stage as keyof typeof STAGE_LABEL] ?? r.stage}</span></span>
        <span role="cell" data-label={tw.many(T.role)} className="cut" title={r.roles.join(', ')}>{r.roles.length ? r.roles.join(', ') : <span className="muted">–</span>}</span>
        <span role="cell" data-label="Position" className="cut">{workLine(r.workTypes)}</span>
        <span role="cell" data-label="Region" className="cut" title={placeLine(r)}>{placeLine(r)}</span>
        <span role="cell" data-label="Documents" className="rl-docs" title={`${r.docs.done} of ${r.docs.total} must-haves done (right to work included)`}>
          <span className={r.docs.done === r.docs.total ? 'ok' : ''}>{docsLine(r.docs)}</span>
          <span className="rl-bar-track" aria-hidden="true"><span className="rl-bar-fill" style={{ width: `${docsPercent(r.docs)}%` }} /></span>
        </span>
        <span role="cell" data-label="Progress" className="rl-prog">
          <span>{waitLine(r.stage, r.days)}</span>
          {r.progress && <span className={`small${r.progress.ready ? ' ok' : ''}`}>{r.progress.done} of {r.progress.total} steps{r.progress.ready ? ' · ready to finish' : ''}</span>}
          {r.needsAction && <span className="badge warn" title={r.docs.toCheck ? 'Documents waiting for you to check' : 'No move for a week or more'}>Needs action</span>}
        </span>
        <span role="cell" data-label="Applied" className="rl-applied">
          <span>{shortDate(r.appliedAt, zone, data.today)}</span>
          <span className="muted small">{r.source === 'online' ? 'Online' : 'Office'}</span>
        </span>
      </div>
    );
  }
}
