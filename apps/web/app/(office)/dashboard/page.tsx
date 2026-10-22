import { api } from '../../../lib/api';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const facilities = await api<unknown[]>('/facilities');
  return (
    <>
      <h1>Dashboard</h1>
      <p className="muted">An overview of your agency. More panels appear here as rostering and compliance are added.</p>
      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="muted">Facilities</div>
          <div className="stat">{facilities.length}</div>
          <a href="/facilities">Manage facilities</a>
        </div>
      </div>
    </>
  );
}
