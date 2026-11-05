import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { Badge } from '../../../lib/format';
import { listFilter, statusBadge, type ProjectStatus } from '../../../lib/projects';
import { T, words } from '../../../lib/terms';
import { Notices } from '../notices';
import { NewProjectForm } from './new-project-form';

export const dynamic = 'force-dynamic';

type ProjectRow = {
  id: string; name: string; code: string | null; status: ProjectStatus; statusLabel: string; dates: string | null; clientId?: string | null; clientName: string | null;
  managerName: string | null; officeName: string | null; teamSize: number; shiftsThisWeek: number; unfilledThisWeek: number; unfilledNext7: number;
  equipmentCount: number; areaCount: number;
};
type Person = { userId: string; name: string; role: string };

/**
 * Projects (David and Steve, 4 Nov): work a business runs itself, each a site of kind project with its own team,
 * equipment and stock. Listed with what needs the office at a glance; archived ones on their own filter.
 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ show?: string; new?: string; clientId?: string; error?: string; done?: string }> }) {
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
        {P} sit under {tw.lower(T.client, true)} (add one from a {tw.lower(T.client)}&apos;s page or the roster), each with its own {tw.lower(T.area, true)}, team, {tw.lower(T.equipment)} and {tw.lower(T.item, true)}, and its own roster.
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
                  <div className="muted small">
                    {p.clientName && p.clientId && <><Link href={`/clients/${p.clientId}`}>{p.clientName}</Link> · </>}
                    {[!p.clientId && p.clientName, p.officeName && `${p.officeName} office`, tw.count(p.areaCount, T.area)].filter(Boolean).join(' · ')}
                  </div>
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
          <NewProjectForm from="projects" clients={clients} people={people} offices={offices} country={settings.country ?? 'AU'} clientId={sp.clientId} />
        </details>
      )}
    </>
  );
}
