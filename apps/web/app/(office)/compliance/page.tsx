import Link from 'next/link';
import { api } from '../../../lib/api';
import { businessZone } from '../../../lib/business';
import { Badge, formatDate, VERIFICATION_LABEL } from '../../../lib/format';

export const dynamic = 'force-dynamic';

type Item = { id: string; workerId: string; workerName: string; typeName: string; number: string | null; expiryDate: string | null; verification?: string; createdAt: string };
type Summary = {
  today: string; activeWorkers: number; days: number;
  counts: { compliant: number; expiring: number; non_compliant: number };
  verificationQueue: Item[]; expiringSoon: Item[];
};

export default async function CompliancePage() {
  const [s, zone] = await Promise.all([api<Summary>('/compliance/summary'), businessZone()]);
  return (
    <>
      <h1>Compliance</h1>
      <p className="muted">Active workers against your credential rules, as at {formatDate(s.today)}.</p>

      <div className="grid">
        <Link className="card" href="/workers?compliance=compliant" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="muted">Compliant</div><div className="stat" style={{ color: 'var(--ok)' }}>{s.counts.compliant}</div>
        </Link>
        <Link className="card" href="/workers?compliance=expiring" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="muted">Expiring within the window</div><div className="stat" style={{ color: 'var(--warn)' }}>{s.counts.expiring}</div>
        </Link>
        <Link className="card" href="/workers?compliance=non_compliant" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="muted">Not compliant</div><div className="stat" style={{ color: 'var(--bad)' }}>{s.counts.non_compliant}</div>
        </Link>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Waiting for verification ({s.verificationQueue.length})</h2>
        {s.verificationQueue.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing waiting.</p> : (
          <table>
            <thead><tr><th>Worker</th><th>Credential</th><th>Number</th><th>Expires</th><th>Added</th></tr></thead>
            <tbody>
              {s.verificationQueue.map(i => (
                <tr key={i.id}>
                  <td><Link href={`/workers/${i.workerId}`}>{i.workerName}</Link></td>
                  <td>{i.typeName}</td><td>{i.number ?? '—'}</td><td>{formatDate(i.expiryDate)}</td><td>{formatDate(i.createdAt, zone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Expiring in the next {s.days} days ({s.expiringSoon.length})</h2>
        {s.expiringSoon.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing expiring.</p> : (
          <table>
            <thead><tr><th>Worker</th><th>Credential</th><th>Expires</th><th>Verification</th></tr></thead>
            <tbody>
              {s.expiringSoon.map(i => (
                <tr key={i.id}>
                  <td><Link href={`/workers/${i.workerId}`}>{i.workerName}</Link></td>
                  <td>{i.typeName}</td><td>{formatDate(i.expiryDate)}</td><td><Badge label={VERIFICATION_LABEL[i.verification ?? '']} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
