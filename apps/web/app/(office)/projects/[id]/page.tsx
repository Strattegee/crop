import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { Badge } from '../../../../lib/format';
import { moneyFor } from '../../../../lib/money';
import { DISTANCE_TITLE, distanceWords } from '../../../../lib/distance';
import { placeLine, zoneName } from '../../../../lib/places';
import { PlaceFields } from '../../../../lib/place-fields';
import {
  allocatable, dayLine, joinable, parseProjectTab, PROJECT_STATUSES, projectLinks, STATUS_LABEL, statusBadge, TEAM_ROLE_LABEL,
  type ProjectStatus, type ProjectTab,
} from '../../../../lib/projects';
import { T, words, type Words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { OfficeField } from '../../settings/offices/office-field';
import { industryGroups, type PackInfo } from '../../../../lib/industry-groups';
import { dayLabel, type StagesView } from '../../../../lib/project-stages';
import type { RoleRow } from '../../teams/make-up-lines';
import { StagesTab, type TeamChoice } from './stages-tab';
import {
  addTeamMember, addWorkArea, allocateEquipment, endAllocation, moveAllocation, removeAllocation, removeTeamMember, setWorkAreaActive,
  setProjectSupervisorFromOverview, updateProject, updateTeamMember,
} from '../actions';

export const dynamic = 'force-dynamic';

type Member = { id: string; workerId: string; name: string; roles: string[]; teamRole: string; areaId: string | null; areaName: string | null;
  startsOn: string; endsOn: string | null; state: 'current' | 'upcoming' | 'ended'; line: string; distanceKm?: number | null };
type Allocation = { id: string; equipmentId: string; equipmentName: string; typeName: string; equipmentStatus: string; areaId: string | null;
  areaName: string | null; note: string | null; startsOn: string; endsOn: string | null; state: 'current' | 'upcoming' | 'ended'; line: string;
  checkState?: 'ok' | 'due_soon' | 'overdue'; checks?: { name: string; dueOn: string }[] };
type Project = {
  id: string; name: string; kind: string; code: string | null; description: string | null; status: ProjectStatus | null; statusLabel: string | null;
  startsOn: string | null; endsOn: string | null; dates: string | null; clientId: string | null; clientName: string | null; officeId: string | null;
  officeName: string | null; managerUserId: string | null; managerName: string | null; supervisorWorkerId: string | null; supervisorName: string | null; timezone: string; addressLine: string | null; suburb: string | null;
  state: string | null; postcode: string | null; country: string; active: boolean; today: string; weekStart: string;
  areas: { id: string; name: string; specialty: string | null; active: boolean }[];
  team: Member[]; days: { day: string; rostered: number; filled: number; unfilled: number }[]; week: { shifts: number; unfilled: number };
  equipment: Allocation[]; stock: { itemId: string; name: string; unit: string; onHand: number; reorderLevel: number | null; low: boolean }[];
  counts: { team: number; equipment: number; equipmentUnavailable: number; equipmentChecks: number; lowStock: number };
};

const EQUIP_STATUS: Record<string, string> = { active: 'In use', out_of_service: 'Out of service', retired: 'Retired' };
const CHECK_LABEL: Record<string, [string, string]> = { ok: ['Dates current', 'ok'], due_soon: ['A date is due soon', 'warn'], overdue: ['A date is overdue', 'bad'] };

function Tile({ title, value, note, warn }: { title: string; value: string | number; note?: string; warn?: boolean }) {
  return (
    <div className="proj-tile">
      <h3>{title}</h3>
      <div className={`big${warn ? ' warn' : ''}`}>{value}</div>
      {note && <div className="muted small">{note}</div>}
    </div>
  );
}

function AreaSelect({ areas, value, tw }: { areas: Project['areas']; value?: string | null; tw: Words }) {
  return (
    <label>{tw.one(T.area)}
      <select name="areaId" defaultValue={value ?? ''}>
        <option value="">Whole {tw.lower(T.project)}</option>
        {areas.filter(a => a.active || a.id === value).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );
}

/** One project (a site of kind project): overview, team, work areas, equipment and consumables, in tabs in the URL. */
export default async function ProjectPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string; done?: string; past?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab: ProjectTab = parseProjectTab(sp.tab);
  const [tw, agency, p] = await Promise.all([words(), currentAgency(), api<Project>(`/projects/${id}`)]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const links = projectLinks(p, p.weekStart);
  const href = (t: ProjectTab) => (t === 'overview' ? `/projects/${id}` : `/projects/${id}?tab=${t}`);
  const shifts = tw.lower(T.shift, true);
  const isProject = p.kind === 'project';
  // Stages (David, 5 Nov): office roles change them; supervisors only read.
  const canPlan = agency?.role === 'owner' || agency?.role === 'admin' || agency?.role === 'allocator';
  const tabs: [ProjectTab, string, number | null][] = [
    ['overview', 'Overview', null], ...(isProject ? [['stages', 'Stages', null] as [ProjectTab, string, number | null]] : []), ['team', 'Team', p.counts.team], ['areas', tw.many(T.area), p.areas.filter(a => a.active).length],
    ['equipment', tw.one(T.equipment), p.counts.equipment], ['consumables', tw.many(T.item), null],
  ];

  const onStages = tab === 'stages' && isProject;
  const stages = onStages ? await api<StagesView>(`/projects/${id}/stages`) : null;
  const [teamList, stageRoles, stagePacks, stagePeople, stageEquipment, stageCodes] = onStages && canPlan ? await Promise.all([
    api<{ teams: TeamChoice[] }>('/teams').then(r => r.teams).catch(() => [] as TeamChoice[]),
    api<RoleRow[]>('/roles').catch(() => [] as RoleRow[]),
    api<PackInfo[]>('/industry-packs').catch(() => [] as PackInfo[]),
    api<{ id: string; firstName: string; lastName: string; preferredName: string | null; status: string; roles: string[] }[]>('/workers').catch(() => []),
    api<{ id: string; name: string; typeName: string; status: string }[]>('/equipment').catch(() => []),
    api<{ id: string; code: string; name: string; active?: boolean }[]>(`/shift-codes?facilityId=${id}`).catch(() => []),
  ]) : [[], [], [], [], [], []];
  const supervisorPeople = tab === 'overview' && canPlan && isProject
    ? (await api<{ id: string; firstName: string; lastName: string; preferredName: string | null; status: string; roles: string[] }[]>('/workers').catch(() => []))
      .filter(w => w.status === 'active').map(w => ({ id: w.id, name: `${w.preferredName || w.firstName} ${w.lastName}` })).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const team = tab === 'team' ? await api<Member[]>(`/facilities/${id}/team${sp.past ? '?all=true' : ''}`) : p.team;
  const people = tab === 'team' ? await api<{ id: string; firstName: string; lastName: string; preferredName: string | null; status: string; roles: string[] }[]>('/workers').catch(() => []) : [];
  // How far each person lives from here (David, 4 Nov): approximate km between postcodes, never the address.
  const joining = tab === 'team' ? joinable(people, team) : [];
  const away = joining.length
    ? (await api<{ distances: Record<string, number | null> }>(`/facilities/${id}/distances`, { method: 'POST', body: { workerIds: joining.map(w => w.id) } })
      .catch(() => ({ distances: {} as Record<string, number | null> }))).distances
    : {};
  const showDistance = team.some(m => m.distanceKm != null);
  const allocations = tab === 'equipment' ? await api<Allocation[]>(`/facilities/${id}/equipment${sp.past ? '?all=true' : ''}`) : [];
  const [equipment, sites] = tab === 'equipment' ? await Promise.all([
    api<{ id: string; name: string; typeName: string; status: string }[]>('/equipment').catch(() => []),
    api<{ id: string; name: string; kind?: string; active: boolean }[]>('/facilities').catch(() => []),
  ]) : [[], []];
  const usage = tab === 'consumables' ? await api<{ lines: { itemId: string; name: string; unit: string; quantity: number; costCents: number; chargeCents: number | null }[]; totalCostCents: number; totalChargeCents: number }>(`/facilities/${id}/items`).catch(() => null) : null;
  const [settings, offices, managers, clients] = tab === 'overview' && canEdit ? await Promise.all([
    api<{ country?: string }>('/settings').catch(() => ({} as { country?: string })),
    api<{ id: string; name: string; active: boolean }[]>('/offices').catch(() => []),
    api<{ userId: string; name: string }[]>('/offices/people').catch(() => []),
    api<{ id: string; name: string; status: string }[]>('/clients').catch(() => []),
  ]) : [{} as { country?: string }, [], [], []];
  const money = moneyFor(p.country);

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        {p.clientId && p.clientName
          ? <><Link href={`/clients/${p.clientId}`}>← {p.clientName}</Link> <span className="muted">·</span> <Link href="/projects">All {tw.lower(T.project, true)}</Link></>
          : <Link href="/projects">← {tw.many(T.project)}</Link>}
      </p>
      <h1 style={{ marginBottom: 4 }}>{p.name} {p.code && <span className="muted" style={{ fontWeight: 400 }}>· {p.code}</span>} {isProject && <Badge label={statusBadge(p.status)} />}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {[p.dates, p.clientName && `For ${p.clientName}`, p.managerName && `Manager: ${p.managerName}`, p.officeName && `${p.officeName} office`, placeLine(p) || null, `${zoneName(p.timezone)} time`].filter(Boolean).join(' · ')}
      </p>
      <Notices error={sp.error} done={sp.done} />
      <div className="proj-links">
        <Link className="btn small" href={links.roster}>Open the roster</Link>
        <Link className="btn small secondary" href={links.template}>Roster template</Link>
        {links.allocations && <Link className="btn small secondary" href={links.allocations}>Allocations for {p.clientName}</Link>}
        {links.live && <Link className="btn small secondary" href={links.live}>Live numbers for {p.officeName}</Link>}
      </div>
      <nav className="ptabs" aria-label={`Parts of this ${tw.lower(T.project)}`}>
        {tabs.map(([t, label, n]) => (
          <Link key={t} href={href(t)} aria-current={t === tab ? 'page' : undefined}>{label}{n !== null ? <span className="muted small"> {n}</span> : null}</Link>
        ))}
      </nav>

      {tab === 'overview' && (<>
        <div className="proj-tiles">
          {p.days.map((d, i) => (
            <Tile key={d.day} title={i === 0 ? 'Today' : 'Tomorrow'} value={d.unfilled ? `${d.unfilled} unfilled` : d.rostered ? 'All filled' : '—'}
              note={dayLine(d, shifts)} warn={d.unfilled > 0} />
          ))}
          <Tile title={`This week`} value={`${p.week.shifts} ${shifts}`} note={p.week.unfilled ? `${p.week.unfilled} unfilled` : 'None unfilled'} warn={p.week.unfilled > 0} />
          <Tile title="Team today" value={p.counts.team} note={`${p.team.filter(m => m.state === 'upcoming').length} starting later`} />
          <Tile title={tw.one(T.equipment)} value={p.counts.equipment}
            note={[p.counts.equipmentUnavailable && `${p.counts.equipmentUnavailable} out of service`, p.counts.equipmentChecks && `${p.counts.equipmentChecks} needing checks`].filter(Boolean).join(' · ') || 'All available'}
            warn={p.counts.equipmentUnavailable + p.counts.equipmentChecks > 0} />
          <Tile title={`Low ${tw.lower(T.item, true)}`} value={p.counts.lowStock} note={p.stock.length ? `${p.stock.length} counted here` : 'Nothing counted here yet'} warn={p.counts.lowStock > 0} />
        </div>
        {p.description && <div className="card"><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.description}</p></div>}
        {isProject && (
          <div className="card">
            <h2>Supervisor</h2>
            <p className="small" style={{ marginTop: 0 }}>{p.supervisorName
              ? <><Link href={`/workers/${p.supervisorWorkerId}`}>{p.supervisorName}</Link> <span className="muted">· works on this {tw.lower(T.project)} full time and is rostered with every stage (<Link href={href('stages')}>Stages</Link>)</span></>
              : <span className="muted">Nobody yet. The supervisor works on this {tw.lower(T.project)} full time and is rostered on every working day of its <Link href={href('stages')}>stages</Link>.</span>}</p>
            {canPlan && (
              <form action={setProjectSupervisorFromOverview.bind(null, id)} className="form-row">
                <label>{p.supervisorName ? 'Change to' : 'Choose'}
                  <select name="workerId" defaultValue={p.supervisorWorkerId ?? ''}>
                    <option value="">Nobody</option>
                    {supervisorPeople.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
                <button className="btn small" type="submit">Save</button>
              </form>
            )}
          </div>
        )}
        <div className="card">
          <h2>Team</h2>
          {p.team.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nobody on the team yet. <Link href={href('team')}>Add people</Link>; they come first when you fill this {tw.lower(T.project)}&apos;s {shifts}.</p> : (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {p.team.slice(0, 12).map(m => <li key={m.id}><Link href={`/workers/${m.workerId}`}>{m.name}</Link> <span className="muted small">· {TEAM_ROLE_LABEL[m.teamRole]}{m.areaName && ` · ${m.areaName}`}{m.state === 'upcoming' && ` · ${m.line}`}{distanceWords(m.distanceKm) && ` · ${distanceWords(m.distanceKm)} from home`}</span></li>)}
              {p.team.length > 12 && <li><Link href={href('team')}>All {p.team.length}</Link></li>}
            </ul>
          )}
        </div>
        {p.equipment.some(e => e.state === 'current' && (e.equipmentStatus !== 'active' || e.checkState !== 'ok')) && (
          <div className="card">
            <h2>{tw.one(T.equipment)} needing attention</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {p.equipment.filter(e => e.state === 'current' && (e.equipmentStatus !== 'active' || e.checkState !== 'ok')).map(e => (
                <li key={e.id}><Link href={`/equipment/${e.equipmentId}`}>{e.equipmentName}</Link> <span className="muted small">· {e.equipmentStatus !== 'active' ? EQUIP_STATUS[e.equipmentStatus] : CHECK_LABEL[e.checkState ?? 'ok'][0]}</span></li>
              ))}
            </ul>
          </div>
        )}
        {p.stock.some(s => s.low) && (
          <div className="card">
            <h2>Low {tw.lower(T.item, true)}</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{p.stock.filter(s => s.low).map(s => <li key={s.itemId}>{s.name}: {s.onHand} {s.unit} <span className="muted small">(reorder at {s.reorderLevel})</span></li>)}</ul>
          </div>
        )}
        {canEdit && (
          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edit {tw.lower(T.project)}</summary>
            <form action={updateProject.bind(null, id)} className="form-row" style={{ marginTop: 12 }}>
              <label>Name<input name="name" required defaultValue={p.name} maxLength={200} /></label>
              <label>Code or reference<input name="code" defaultValue={p.code ?? ''} maxLength={30} /></label>
              {isProject && (
                <label>Status
                  <select name="status" defaultValue={p.status ?? 'active'}>{PROJECT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
                </label>
              )}
              <label>{tw.one(T.client)}
                <select name="clientId" defaultValue={p.clientId ?? ''}>
                  <option value="">None: our own work</option>
                  {clients.filter(c => c.status !== 'inactive' || c.id === p.clientId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>Manager
                <select name="managerUserId" defaultValue={p.managerUserId ?? ''}>
                  <option value="">Not chosen</option>
                  {managers.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </select>
              </label>
              <label>Starts<input type="date" name="startsOn" defaultValue={p.startsOn ?? ''} /></label>
              <label>Expected completion<input type="date" name="endsOn" defaultValue={p.endsOn ?? ''} /></label>
              <label style={{ flexBasis: '100%' }}>Street address<input name="addressLine" defaultValue={p.addressLine ?? ''} maxLength={200} /></label>
              <PlaceFields d={p} homeCountry={settings.country ?? 'AU'} editing />
              <OfficeField offices={offices} value={p.officeId} />
              <label style={{ flexBasis: '100%' }}>Description<textarea name="description" rows={2} maxLength={2000} defaultValue={p.description ?? ''} /></label>
              <button type="submit" className="btn">Save</button>
            </form>
            <p className="muted small" style={{ marginBottom: 0 }}>Archived keeps every record and takes the {tw.lower(T.project)} out of the lists you pick from. Parking and entry notes are on its <Link href={`/facilities/${id}`}>{tw.lower(T.site)} page</Link>.</p>
          </details>
        )}
      </>)}

      {onStages && stages && (
        <StagesTab id={id} v={stages} canEdit={canPlan} tw={tw} areas={p.areas} codes={stageCodes} teams={teamList}
          roleGroups={industryGroups(stageRoles.filter(r => r.active !== false), stagePacks)}
          people={stagePeople.filter(w => w.status === 'active').map(w => ({ id: w.id, name: `${w.preferredName || w.firstName} ${w.lastName}`, roles: w.roles }))}
          equipment={stageEquipment} dateLabel={dayLabel} />
      )}

      {tab === 'team' && (<>
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Team</h2>
          <p className="muted small">Who belongs to this {tw.lower(T.project)}. Separate from {shifts}: the team comes first when you fill its {shifts}, and anyone else can still work them.</p>
          {team.length === 0 ? <p className="muted">Nobody yet.</p> : (
            <table className="proj-stack">
              <thead><tr><th>Person</th><th>On the team as</th><th>{tw.one(T.area)}</th><th>Dates</th>{showDistance && <th title={DISTANCE_TITLE}>From home</th>}<th /></tr></thead>
              <tbody>{team.map(m => (
                <tr key={m.id} style={{ opacity: m.state === 'ended' ? 0.55 : 1 }}>
                  <td><Link href={`/workers/${m.workerId}`}>{m.name}</Link><div className="muted small">{m.roles.join(', ')}</div></td>
                  <td>{TEAM_ROLE_LABEL[m.teamRole]}</td>
                  <td>{m.areaName ?? <span className="muted">Whole {tw.lower(T.project)}</span>}</td>
                  <td className="small">{m.line}</td>
                  {showDistance && <td className="small" title={DISTANCE_TITLE}>{distanceWords(m.distanceKm) ?? <span className="muted">–</span>}</td>}
                  <td>
                    <div className="proj-row-actions">
                      <details>
                        <summary className="small">Change</summary>
                        <form action={updateTeamMember.bind(null, id, m.id)}>
                          <label className="small">As<select name="teamRole" defaultValue={m.teamRole}><option value="worker">Worker</option><option value="supervisor">Supervisor</option></select></label>
                          <AreaSelect areas={p.areas} value={m.areaId} tw={tw} />
                          <label className="small">Last day<input type="date" name="endsOn" defaultValue={m.endsOn ?? ''} /></label>
                          <button className="btn small" type="submit">Save</button>
                        </form>
                      </details>
                      <form action={removeTeamMember.bind(null, id, m.id)}><button className="btn small secondary" type="submit" title="Added by mistake: kept on file">Take off</button></form>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="small" style={{ marginBottom: 0 }}>{sp.past ? <Link href={href('team')}>Hide people who have left</Link> : <Link href={`${href('team')}&past=1`}>Show people who have left</Link>}</p>
        </div>
        <div className="card">
          <h2>Add to the team</h2>
          <form action={addTeamMember.bind(null, id)} className="form-row">
            <label>Person
              <select name="workerId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {joining.map(w => <option key={w.id} value={w.id}>{w.preferredName || w.firstName} {w.lastName}{w.roles.length ? ` (${w.roles.join(', ')})` : ''}{distanceWords(away[w.id]) ? ` · ${distanceWords(away[w.id])}` : ''}</option>)}
              </select>
            </label>
            <label>As<select name="teamRole" defaultValue="worker"><option value="worker">Worker</option><option value="supervisor">Supervisor</option></select></label>
            <AreaSelect areas={p.areas} tw={tw} />
            <label>From<input type="date" name="startsOn" defaultValue={p.today} /></label>
            <label>Last day (optional)<input type="date" name="endsOn" /></label>
            <button type="submit" className="btn">Add</button>
          </form>
        </div>
      </>)}

      {tab === 'areas' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>{tw.many(T.area)}</h2>
          {p.areas.length === 0 ? <p className="muted">None yet. {tw.many(T.shift)} are rostered into {tw.lower(T.area, true)}.</p> : (
            <table>
              <thead><tr><th>Name</th><th>Notes</th><th /></tr></thead>
              <tbody>{p.areas.map(a => (
                <tr key={a.id} style={{ opacity: a.active ? 1 : 0.5 }}>
                  <td>{a.name}{!a.active && ' (closed)'}</td><td>{a.specialty ?? '—'}</td>
                  <td>{canEdit && <form action={setWorkAreaActive.bind(null, id, a.id, !a.active)}><button className="btn small secondary" type="submit">{a.active ? 'Close' : 'Reopen'}</button></form>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {canEdit && (
            <form action={addWorkArea.bind(null, id)} className="form-row" style={{ marginTop: 12 }}>
              <label>Name (several: separate with commas)<input name="name" required maxLength={1000} placeholder="e.g. Level 3, Level 4" /></label>
              <label>Notes<input name="specialty" maxLength={80} /></label>
              <button type="submit" className="btn">Add</button>
            </form>
          )}
        </div>
      )}

      {tab === 'equipment' && (<>
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>{tw.one(T.equipment)} on this {tw.lower(T.project)}</h2>
          <p className="muted small">While it&apos;s allocated here, booking it onto a {tw.lower(T.shift)} anywhere else is refused for those dates.</p>
          {allocations.length === 0 ? <p className="muted">Nothing allocated.</p> : (
            <table className="proj-stack">
              <thead><tr><th>{tw.one(T.equipment)}</th><th>{tw.one(T.area)}</th><th>Dates</th><th /></tr></thead>
              <tbody>{allocations.map(a => (
                <tr key={a.id} style={{ opacity: a.state === 'ended' ? 0.55 : 1 }}>
                  <td><Link href={`/equipment/${a.equipmentId}`}>{a.equipmentName}</Link> <span className="muted small">· {a.typeName}{a.equipmentStatus !== 'active' && ` · ${EQUIP_STATUS[a.equipmentStatus]}`}</span>{a.note && <div className="muted small">{a.note}</div>}</td>
                  <td>{a.areaName ?? <span className="muted">Whole {tw.lower(T.project)}</span>}</td>
                  <td className="small">{a.line}</td>
                  <td>{a.state !== 'ended' && (
                    <div className="proj-row-actions">
                      <details>
                        <summary className="small">Dates</summary>
                        <form action={endAllocation.bind(null, id, a.id)}>
                          <label className="small">Last day<input type="date" name="lastDay" defaultValue={a.endsOn ?? ''} /></label>
                          <button className="btn small" type="submit">Save</button>
                        </form>
                      </details>
                      <details>
                        <summary className="small">Move</summary>
                        <form action={moveAllocation.bind(null, id, a.id)}>
                          <label className="small">To
                            <select name="facilityId" required defaultValue="">
                              <option value="" disabled>Choose…</option>
                              {sites.filter(s => s.active && s.id !== id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </label>
                          <label className="small">From<input type="date" name="onDate" defaultValue={p.today} /></label>
                          <button className="btn small" type="submit">Move</button>
                        </form>
                      </details>
                      <form action={removeAllocation.bind(null, id, a.id)}><button className="btn small secondary" type="submit" title="Added by mistake: kept on file">Take off</button></form>
                    </div>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <p className="small" style={{ marginBottom: 0 }}>{sp.past ? <Link href={href('equipment')}>Hide ended</Link> : <Link href={`${href('equipment')}&past=1`}>Show ended</Link>}</p>
        </div>
        <div className="card">
          <h2>Allocate {tw.lower(T.equipment)}</h2>
          <form action={allocateEquipment.bind(null, id)} className="form-row">
            <label>{tw.one(T.equipment)}
              <select name="equipmentId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {allocatable(equipment, allocations).map(e => <option key={e.id} value={e.id}>{e.name} ({e.typeName}){e.status !== 'active' ? ` · ${EQUIP_STATUS[e.status]}` : ''}</option>)}
              </select>
            </label>
            <AreaSelect areas={p.areas} tw={tw} />
            <label>From<input type="date" name="startsOn" defaultValue={p.today} /></label>
            <label>Last day (optional)<input type="date" name="endsOn" /></label>
            <label>Note<input name="note" maxLength={300} /></label>
            <button type="submit" className="btn">Allocate</button>
          </form>
        </div>
      </>)}

      {tab === 'consumables' && (<>
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>On hand here</h2>
          {p.stock.length === 0 ? <p className="muted">Nothing counted here yet.</p> : (
            <table>
              <thead><tr><th>{tw.one(T.item)}</th><th className="num">On hand</th><th className="num">Reorder at</th></tr></thead>
              <tbody>{p.stock.map(s => (
                <tr key={s.itemId}><td>{s.name}{s.low && <> <span className="badge warn">Low</span></>}</td><td className="num">{s.onHand} {s.unit}</td><td className="num">{s.reorderLevel ?? '—'}</td></tr>
              ))}</tbody>
            </table>
          )}
          <p className="small" style={{ marginBottom: 0 }}>Receive, transfer between {tw.lower(T.site, true)} or count stock on the <Link href="/items">{tw.many(T.item)}</Link> page; issue to people from the roster.</p>
        </div>
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Used on this {tw.lower(T.project)}</h2>
          {!usage || usage.lines.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing issued or used yet.</p> : (
            <table>
              <thead><tr><th>{tw.one(T.item)}</th><th className="num">Used</th><th className="num">Cost</th><th className="num">Charge</th></tr></thead>
              <tbody>
                {usage.lines.map(l => <tr key={l.itemId}><td>{l.name}</td><td className="num">{l.quantity} {l.unit}</td><td className="num">{money(l.costCents)}</td><td className="num">{money(l.chargeCents)}</td></tr>)}
                <tr><td><strong>Total</strong></td><td /><td className="num"><strong>{money(usage.totalCostCents)}</strong></td><td className="num"><strong>{money(usage.totalChargeCents)}</strong></td></tr>
              </tbody>
            </table>
          )}
        </div>
      </>)}
    </>
  );
}
