import Link from 'next/link';
import { api } from '../../../lib/api';
import { businessZone, whenIn } from '../../../lib/business';
import { T, words } from '../../../lib/terms';
import { Notices } from '../notices';

export const dynamic = 'force-dynamic';

type Requirement = { name: string; severity: 'hard' | 'warning' | 'optional'; forDuty: string | null; credentialTypeId: string | null };
type Request = {
  id: string; connectionId: string; employerName: string; siteName: string; siteRegion: string | null; areaName: string | null; role: string;
  when: string; startsIn: string; breakMinutes: number; duties: string[]; requirements: Requirement[]; note: string | null;
  status: 'open' | 'filled' | 'withdrawn' | 'expired'; receivedAt: string; closedAt: string | null; closedReason: string | null; unmatched: number;
};

const LEVEL: Record<Requirement['severity'], string> = { hard: 'Must have', warning: 'Should have', optional: 'Optional' };
const CLOSED: Record<string, string> = { filled: 'Filled', withdrawn: 'Withdrawn', expired: 'Expired' };

/**
 * Allocations (function code 2200, agency fill first slice): the requests employers have sent this business, soonest
 * first, with what each needs. Putting people forward comes next.
 */
export default async function AllocationsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [list, tw, zone, sp] = await Promise.all([api<Request[]>('/agency-requests?status=all'), words(), businessZone(), searchParams]);
  const when = whenIn(zone);
  const open = list.filter(r => r.status === 'open');
  const closed = list.filter(r => r.status !== 'open');
  const shift = tw.lower(T.shift);
  return (
    <>
      <h1>Allocations</h1>
      <p className="muted">
        {tw.one(T.shift)} requests from the employers you supply, soonest first. Times are the site&apos;s local time.
        Choosing who goes comes next; for now, call the employer to put someone forward.
      </p>
      <Notices error={sp.error} done={sp.done} />
      <div className="card">
        <h2>Open ({open.length})</h2>
        {open.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No open requests. When an employer sends you a {shift}, it shows here and your owners and admins get an email.</p>
        ) : open.map(r => (
          <div key={r.id} className="alloc-row" style={{ borderTop: '1px solid var(--line, #e5e5e5)', padding: '10px 0' }}>
            <p style={{ margin: 0 }}>
              <strong>{r.role}</strong> · {r.employerName} · {[r.areaName, r.siteName, r.siteRegion].filter(Boolean).join(', ')}
            </p>
            <p style={{ margin: '2px 0' }}>{r.when}{r.breakMinutes ? ` (${r.breakMinutes} min break)` : ''} <span className="muted">· starts {r.startsIn}</span></p>
            {r.duties.length > 0 && <p className="small" style={{ margin: '2px 0' }}>Duties: {r.duties.join(', ')}</p>}
            {r.note && <p className="small" style={{ margin: '2px 0' }}>Note from {r.employerName}: {r.note}</p>}
            {r.requirements.length > 0 && (
              <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {r.requirements.map(q => (
                  <li key={`${q.name}-${q.forDuty ?? ''}`}>
                    {LEVEL[q.severity]}: {q.name}{q.forDuty ? ` (for ${q.forDuty})` : ''}
                    {q.severity !== 'optional' && !q.credentialTypeId && <span className="warnline"> ⚠ not matched to your credentials</span>}
                  </li>
                ))}
              </ul>
            )}
            {r.unmatched > 0 && (
              <p className="small" style={{ margin: '4px 0 0' }}>
                <Link href={`/settings/agencies/${r.connectionId}`}>Match {r.employerName}&apos;s requirements</Link> so CROP can check your people against them.
              </p>
            )}
            <p className="muted small" style={{ margin: '4px 0 0' }}>Received {when(r.receivedAt)}</p>
          </div>
        ))}
      </div>
      {closed.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Closed in the last 30 days</h2>
          <table>
            <thead><tr><th>{tw.one(T.shift)}</th><th>Employer</th><th>When</th><th>Outcome</th></tr></thead>
            <tbody>
              {closed.map(r => (
                <tr key={r.id}>
                  <td>{r.role} · {r.siteName}</td><td>{r.employerName}</td><td>{r.when}</td>
                  <td>{CLOSED[r.status] ?? r.status}{r.closedReason ? <span className="muted"> · {r.closedReason}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
