import Link from 'next/link';
import { api } from '../../../lib/api';

export const dynamic = 'force-dynamic';

type Summary = { activeWorkers: number; counts: { compliant: number; expiring: number; non_compliant: number }; verificationQueue: unknown[] };

export default async function Dashboard() {
  const [facilities, s, types] = await Promise.all([
    api<unknown[]>('/facilities'), api<Summary>('/compliance/summary'), api<unknown[]>('/credential-types'),
  ]);
  return (
    <>
      <h1>Dashboard</h1>
      <p className="muted">An overview of your agency. Rostering and shifts will appear here as they're added.</p>
      {types.length === 0 && (
        <div className="notice success">Getting started: set up credential types in <Link href="/settings">Settings</Link>, then add your <Link href="/workers">workers</Link>.</div>
      )}
      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card"><div className="muted">Active workers</div><div className="stat">{s.activeWorkers}</div><Link href="/workers">View workers</Link></div>
        <div className="card"><div className="muted">Not compliant</div><div className="stat" style={{ color: 'var(--bad)' }}>{s.counts.non_compliant}</div><Link href="/workers?compliance=non_compliant">See who</Link></div>
        <div className="card"><div className="muted">Expiring soon</div><div className="stat" style={{ color: 'var(--warn)' }}>{s.counts.expiring}</div><Link href="/compliance">Compliance</Link></div>
        <div className="card"><div className="muted">Waiting for verification</div><div className="stat">{s.verificationQueue.length}</div><Link href="/compliance">Review</Link></div>
        <div className="card"><div className="muted">Facilities</div><div className="stat">{facilities.length}</div><Link href="/facilities">Manage</Link></div>
      </div>
    </>
  );
}
