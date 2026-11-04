import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { Badge } from '../../../lib/format';
import { PlaceFields } from '../../../lib/place-fields';
import { listFilter, statusBadge, type ProjectStatus } from '../../../lib/projects';
import { T, words } from '../../../lib/terms';
import { Notices } from '../notices';
import { OfficeField } from '../settings/offices/office-field';
import { addProject } from './actions';

export const dynamic = 'force-dynamic';

type ProjectRow = {
  id: string; name: string; code: string | null; status: ProjectStatus; statusLabel: string; dates: string | null; clientName: string | null;
  managerName: string | null; officeName: string | null; teamSize: number; shiftsThisWeek: number; unfilledThisWeek: number; unfilledNext7: number;
  equipmentCount: number; areaCount: number;
};
type Person = { userId: string; name: string; role: string };

/**
 * Projects (David and Steve, 4 Nov): work a business runs itself, each a site of kind project with its own team,
 * equipment and stock. Listed with what needs the office at a glance; archived ones on their own filter.
 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ show?: string; new?: string; error?: string; done?: string }> }) {
  const sp = await searchParams;
  const show = listFilter(sp.show);
  const [tw, agency, rows] = await Promise.all([
    words(), currentAgency(), api<ProjectRow[]>(`/projects${show === 'live' ? '' : `?status=${show}`}`),
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const [clients, offices, people, settings] = canEdit ? await Promise.all([
    api<{ id: string; name: string; status: string }[]>('/clients').catch(() => []),
    api<{ id: string; name: string; active: boolean }[]>('/offices').catch(() => []),
    api<Person[]>('/offices/people').catch(() => [] as Person[]),
    api<{ country?: string }>('/settings').catch(() => ({} as { country?: string })),
  ]) : [[], [], [], {} as { country?: string }];
  const P = tw.many(T.project);
  const shifts = tw.lower(T.shift, true);
  return (
    <>
      <h1>{P}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Work you run yourselves, each with its own {tw.lower(T.area, true)}, team, {tw.lower(T.equipment)} and {tw.lower(T.item, true)}, and its own roster.
      </p>
      <Notices error={sp.error} done={sp.done} />
      <nav className="q-chips" aria-label="Show" style={{ marginBottom: 12 }}>
        {(['live', 'archived', 'all'] as const).map(v => (
          <Link key={v} href={v === 'live' ? '/projects' : `/projects?show=${v}`} className={`q-chip${show === v ? ' on' : ''}`} aria-current={show === v ? 'page' : undefined}>
            {v === 'live' ? 'Current' : v === 'archived' ? 'Archived' : 'All'}
          </Link>
        ))}
      </nav>

      <div className="card" style={{ overflowX: 'auto' }}>
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{show === 'archived' ? `No archived ${P.toLowerCase()}.` : `No ${P.toLowerCase()} yet.`}</p>
        ) : (
          <table className="project-table">
            <thead><tr>
              <th>{tw.one(T.project)}</th><th>Status</th><th>Dates</th><th>Manager</th><th className="num">Team</th>
              <th className="num">{tw.many(T.shift)} this week</th><th className="num">Unfilled, next 7 days</th><th className="num">{tw.one(T.equipment)}</th>
            </tr></thead>
            <tbody>{rows.map(p => (
              <tr key={p.id}>
                <td>
                  <Link href={`/projects/${p.id}`}><strong>{p.name}</strong></Link>{p.code && <span className="muted"> · {p.code}</span>}
                  <div className="muted small">{[p.clientName, p.officeName && `${p.officeName} office`, tw.count(p.areaCount, T.area)].filter(Boolean).join(' · ')}</div>
                </td>
                <td><Badge label={statusBadge(p.status)} /></td>
                <td className="small">{p.dates ?? <span className="muted">—</span>}</td>
                <td className="small">{p.managerName ?? <span className="muted">—</span>}</td>
                <td className="num">{p.teamSize}</td>
                <td className="num">{p.shiftsThisWeek}{p.unfilledThisWeek > 0 && <span className="muted small"> ({p.unfilledThisWeek} open)</span>}</td>
                <td className="num">{p.unfilledNext7 > 0 ? <span className="badge warn">{p.unfilledNext7}</span> : <span className="muted">0</span>}</td>
                <td className="num">{p.equipmentCount}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <details className="card" open={sp.new === '1' || (rows.length === 0 && show === 'live')}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>+ New {tw.lower(T.project)}</summary>
          <p className="muted small">The essentials only; everything can be changed later on its page. Unfilled {shifts} and the roster work as for any {tw.lower(T.site)}.</p>
          <form action={addProject} className="form-row">
            <label>Name<input name="name" required maxLength={200} placeholder="e.g. Smith St Apartments" /></label>
            <label>Code or reference<input name="code" maxLength={30} placeholder="e.g. P-2041" /></label>
            <label>{tw.one(T.client)} (optional)
              <select name="clientId" defaultValue="">
                <option value="">None: our own work</option>
                {clients.filter(c => c.status !== 'inactive').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Manager
              <select name="managerUserId" defaultValue="">
                <option value="">Not chosen yet</option>
                {people.map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              </select>
            </label>
            <label>Starts<input type="date" name="startsOn" /></label>
            <label>Expected completion<input type="date" name="endsOn" /></label>
            <label style={{ flexBasis: '100%' }}>Street address<input name="addressLine" maxLength={200} /></label>
            <PlaceFields homeCountry={settings.country ?? 'AU'} />
            <OfficeField offices={offices} />
            <label style={{ flexBasis: '100%' }}>{tw.many(T.area)}, one per line or separated by commas
              <textarea name="areas" rows={3} maxLength={3000} placeholder={'e.g. Ground floor\nLevel 1\nCar park'} />
            </label>
            <label style={{ flexBasis: '100%' }}>Description (optional)<textarea name="description" rows={2} maxLength={2000} /></label>
            <button type="submit" className="btn">Add {tw.lower(T.project)}</button>
          </form>
        </details>
      )}
    </>
  );
}
