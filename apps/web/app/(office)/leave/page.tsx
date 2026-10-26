import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { Notices } from '../notices';
import { decideLeave } from './actions';

export const dynamic = 'force-dynamic';

type Leave = { id: string; workerId: string; workerName: string; kind: string; startsOn: string; endsOn: string; days: number; status: string; note: string | null; createdAt: string };
const KIND: Record<string, string> = { annual: 'Annual leave', personal: 'Personal leave', long_service: 'Long service leave', unpaid: 'Unpaid leave', other: 'Other leave' };
const d = (s: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));
const span = (l: Leave) => `${d(l.startsOn)}${l.endsOn !== l.startsOn ? ` – ${d(l.endsOn)}` : ''} (${l.days} day${l.days === 1 ? '' : 's'})`;

/** Leave requests to approve and leave coming up (backlog item 10). */
export default async function LeavePage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [list, agency, sp] = await Promise.all([api<Leave[]>('/leave'), currentAgency(), searchParams]);
  const canDecide = agency?.role === 'owner' || agency?.role === 'admin';
  const requested = list.filter(l => l.status === 'requested');
  const approved = list.filter(l => l.status === 'approved');
  return (
    <>
      <h1>Leave</h1>
      <p className="muted">Requests waiting for a decision, and approved leave in the next 90 days. Record leave on a person&apos;s page.</p>
      <Notices error={sp.error} done={sp.done} />
      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Waiting for a decision ({requested.length})</h2>
        {requested.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing waiting.</p> : (
          <table>
            <thead><tr><th>Person</th><th>When</th><th>Type</th><th>Note</th><th /></tr></thead>
            <tbody>
              {requested.map(l => (
                <tr key={l.id}>
                  <td><Link href={`/workers/${l.workerId}`}>{l.workerName}</Link></td>
                  <td>{span(l)}</td><td>{KIND[l.kind] ?? l.kind}</td><td className="muted">{l.note ?? ''}</td>
                  <td>
                    {canDecide ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <form action={decideLeave.bind(null, l.id, 'approve')}><button className="btn small">Approve</button></form>
                        <form action={decideLeave.bind(null, l.id, 'decline')}><button className="btn small secondary">Decline</button></form>
                      </span>
                    ) : <span className="muted small">An owner or admin decides</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Approved leave coming up ({approved.length})</h2>
        {approved.length === 0 ? <p className="muted" style={{ margin: 0 }}>None.</p> : (
          <table>
            <thead><tr><th>Person</th><th>When</th><th>Type</th><th>Note</th><th /></tr></thead>
            <tbody>
              {approved.map(l => (
                <tr key={l.id}>
                  <td><Link href={`/workers/${l.workerId}`}>{l.workerName}</Link></td>
                  <td>{span(l)}</td><td>{KIND[l.kind] ?? l.kind}</td><td className="muted">{l.note ?? ''}</td>
                  <td>{canDecide && (
                    <details><summary className="muted" style={{ cursor: 'pointer' }}>Cancel</summary>
                      <form action={decideLeave.bind(null, l.id, 'cancel')} style={{ marginTop: 6 }}><button className="btn small secondary">Yes, cancel this leave</button></form>
                    </details>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
