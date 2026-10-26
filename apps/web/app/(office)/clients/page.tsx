import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { Badge } from '../../../lib/format';
import { CLIENT_STATUS } from '../../../lib/places';
import { Notices } from '../notices';
import { addClient } from './actions';
import { T, words } from '../../../lib/terms';

export const dynamic = 'force-dynamic';

type ClientRow = { id: string; name: string; abn: string | null; status: string; billingEmail: string | null; facilityCount: number };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const tw = await words();
  const [clients, agency, sp] = await Promise.all([api<ClientRow[]>('/clients'), currentAgency(), searchParams]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  return (
    <>
      <h1>{tw.many(T.client)}</h1>
      <p className="muted">Organisations you supply workers to, with their facilities and wards.</p>
      <Notices error={sp.error} done={sp.done} />
      {canEdit && (
        <details className="card" open={clients.length === 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add a client</summary>
          <form action={addClient} className="form-row" style={{ marginTop: 12 }}>
            <label>Name<input name="name" required maxLength={200} /></label>
            <label>ABN<input name="abn" maxLength={20} placeholder="11 digits" /></label>
            <label>Billing contact<input name="billingContactName" maxLength={200} /></label>
            <label>Billing email<input name="billingEmail" type="email" maxLength={200} /></label>
            <label>Phone<input name="phone" maxLength={30} /></label>
            <button type="submit" className="btn">Add client</button>
          </form>
        </details>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        {clients.length === 0 ? <p className="muted" style={{ margin: 0 }}>No clients yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>ABN</th><th>Facilities</th><th>Billing email</th><th>Status</th></tr></thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id}>
                  <td><Link href={`/clients/${c.id}`}>{c.name}</Link></td>
                  <td>{c.abn ? c.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : '—'}</td>
                  <td>{c.facilityCount}</td>
                  <td>{c.billingEmail ?? '—'}</td>
                  <td><Badge label={CLIENT_STATUS[c.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
