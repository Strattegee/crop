import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { FOCUS_CHOICES, showValue, type Focus, type Unit } from '../../../../lib/dashboard';
import { Notices } from '../../notices';
import { saveTargets, setMember } from './actions';

export const dynamic = 'force-dynamic';

type Member = { userId: string; name: string; email: string; role: string; focus: Focus | null; effectiveFocus: Focus; seesCosts: boolean; costsGranted: boolean };
type Target = { key: string; focus: string; label: string; how: string; unit: Unit; better: 'higher' | 'lower'; suggested: number; target: number | null; setting: boolean };

const ROLE: Record<string, string> = { owner: 'Owner', admin: 'Administrator', allocator: 'Allocator' };
const GROUP: Record<string, string> = { allocator: 'Allocator dashboard', compliance: 'Compliance dashboard', recruitment: 'Recruitment dashboard', agency: 'Agency dashboard' };
const UNIT_WORD: Record<Unit, string> = { percent: '%', count: '', hours: 'hours', days: 'days' };

/**
 * Settings › Dashboards (function 9150, David, 31 Oct): the owner chooses each office person's dashboard (their job
 * focus, separate from what they're allowed to do) and who else may see cost and charge figures; owners and
 * administrators set the business's own targets.
 */
export default async function DashboardSettings({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [agency, targets, sp] = await Promise.all([currentAgency(), api<Target[]>('/dashboard/targets'), searchParams]);
  const isOwner = agency?.role === 'owner';
  const canTarget = isOwner || agency?.role === 'admin';
  const team = isOwner ? await api<Member[]>('/team').catch(() => [] as Member[]) : [];
  const supplier = ((await api<{ agencyLinks: number }>('/allocations/summary').catch(() => null))?.agencyLinks ?? 0) > 0;
  const choices = FOCUS_CHOICES.filter(c => c.value !== 'agency' || supplier);
  const groups = ['allocator', 'compliance', 'recruitment', ...(supplier ? ['agency'] : [])].map(g => ({ g, list: targets.filter(t => t.focus === g) }));

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>Dashboards</h1>
      <p className="muted">
        Everyone in the office lands on a dashboard made for their work. What they can see and do is still set by their access;
        the dashboard only chooses what comes first. Each person also gets one email a day from 8am with their dashboard’s top items
        (numbers off target, what needs attention, decisions waiting and, for Compliance and Overview, dates to follow up), only when something needs them.
      </p>
      <Notices error={sp.error} done={sp.done} />

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Who sees which dashboard</h2>
        {!isOwner ? (
          <p className="muted">Only the owner chooses dashboards and who sees costs.</p>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              Owners always see cost and charge figures; tick “Sees costs” for the senior managers who should too.
              Without a choice, allocators get the Allocator dashboard and everyone else the Overview.
            </p>
            <table className="team-table">
              <thead><tr><th>Name</th><th>Access</th><th>Dashboard</th><th>Sees costs</th><th /></tr></thead>
              <tbody>
                {team.map(m => (
                  <tr key={m.userId}>
                    <td>{m.name}<div className="muted small">{m.email}</div></td>
                    <td>{ROLE[m.role] ?? m.role}</td>
                    <td colSpan={3}>
                      <form action={setMember.bind(null, m.userId)} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select name="focus" defaultValue={m.focus ?? ''} aria-label={`Dashboard for ${m.name}`}>
                          <option value="">Usual for their access ({FOCUS_CHOICES.find(c => c.value === (m.role === 'allocator' ? 'allocator' : 'overview'))!.label})</option>
                          {choices.map(c => <option key={c.value} value={c.value} title={c.hint}>{c.label}</option>)}
                        </select>
                        {m.role === 'owner'
                          ? <span className="muted small">Always</span>
                          : <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="seesCosts" defaultChecked={m.costsGranted} /> Sees costs</label>}
                        <button className="btn small secondary">Save</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="muted small">
              {choices.map(c => <li key={c.value}><strong>{c.label}:</strong> {c.hint}</li>)}
            </ul>
          </>
        )}
      </div>

      <form action={saveTargets} className="card">
        <h2>Your targets</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Each business sets its own. A number on the dashboard is only marked on or off target once you’ve set one here;
          CROP’s suggestion is shown beside each box as a starting point. Leave a box empty for no target.
        </p>
        {!canTarget && <div className="notice error">Only owners and administrators can change targets.</div>}
        {groups.map(({ g, list }) => (
          <fieldset key={g} disabled={!canTarget} style={{ border: 0, padding: 0, margin: '12px 0' }}>
            <h3 style={{ margin: '8px 0' }}>{GROUP[g]}</h3>
            <div className="grid">
              {list.map(t => (
                <label key={t.key} title={t.how}>
                  {t.label}{t.setting ? ' (limit for “Waiting on us”)' : ''}
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="small">{t.better === 'higher' ? 'At least' : 'At most'}</span>
                    <input name={`t:${t.key}`} type="number" min={0} max={t.unit === 'percent' ? 100 : undefined} step={t.unit === 'count' ? 1 : 0.5}
                      defaultValue={t.target ?? ''} placeholder={`e.g. ${t.suggested}`} style={{ width: 90 }} />
                    <span className="small">{UNIT_WORD[t.unit]}</span>
                  </span>
                  <span className="small">Suggested: {showValue(t.suggested, t.unit)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {canTarget && <button className="btn">Save targets</button>}
      </form>
    </>
  );
}
