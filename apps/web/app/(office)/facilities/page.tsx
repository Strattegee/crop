import Link from 'next/link';
import { api } from '../../../lib/api';
import { T, words } from '../../../lib/terms';

export const dynamic = 'force-dynamic';

type Facility = { id: string; name: string; clientId: string | null; clientName: string | null; suburb: string | null; state: string | null; active: boolean };

/** All facilities across clients. New facilities are added from a client's page. */
export default async function FacilitiesPage() {
  const tw = await words();
  const facilities = await api<Facility[]>('/facilities');
  return (
    <>
      <h1>{tw.many(T.site)}</h1>
      <p className="muted">Every site across your clients. To add one, open the <Link href="/clients">client</Link> it belongs to.</p>
      <div className="card" style={{ overflowX: 'auto' }}>
        {facilities.length === 0 ? <p className="muted" style={{ margin: 0 }}>No facilities yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Client</th><th>Location</th></tr></thead>
            <tbody>
              {facilities.map(f => (
                <tr key={f.id} style={{ opacity: f.active ? 1 : 0.5 }}>
                  <td><Link href={`/facilities/${f.id}`}>{f.name}</Link></td>
                  <td>{f.clientId ? <Link href={`/clients/${f.clientId}`}>{f.clientName}</Link> : <span className="muted">Not linked to a client</span>}</td>
                  <td>{[f.suburb, f.state].filter(Boolean).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
