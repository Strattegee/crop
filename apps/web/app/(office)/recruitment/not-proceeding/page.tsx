import Link from 'next/link';
import { api } from '../../../../lib/api';
import { businessZone, whenIn } from '../../../../lib/business';
import { Notices } from '../../notices';
import { moveTo } from '../actions';

export const dynamic = 'force-dynamic';

type Row = { id: string; firstName: string; lastName: string; roles: string[]; at: string; note: string | null; byName: string | null };

/** People marked not proceeding, newest first; any of them can be reopened at Applied. */
export default async function NotProceedingPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const sp = await searchParams;
  const [rows, zone] = await Promise.all([api<Row[]>('/recruitment/not-proceeding'), businessZone()]);
  const when = whenIn(zone);
  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link href="/recruitment">← Recruitment</Link></p>
      <h1>Not proceeding</h1>
      <Notices error={sp.error} done={sp.done} />
      <div className="card" style={{ overflowX: 'auto' }}>
        {rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nobody.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Applied for</th><th>When</th><th>Reason</th><th /></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>
                <td><Link href={`/workers/${r.id}`}>{r.firstName} {r.lastName}</Link></td>
                <td>{r.roles.join(', ') || '—'}</td>
                <td>{when(r.at)}{r.byName && <div className="muted small">by {r.byName}</div>}</td>
                <td>{r.note ?? <span className="muted">—</span>}</td>
                <td><form action={moveTo.bind(null, r.id, 'reopen', 'Reopened at Applied.')}><button className="btn small secondary">Reopen</button></form></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
