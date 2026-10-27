import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { Badge } from '../../../../lib/format';
import { CLIENT_STATUS } from '../../../../lib/places';
import { PlaceFields } from '../../../../lib/place-fields';
import { Notices } from '../../notices';
import { addFacility, updateClient } from '../actions';
import { T, words } from '../../../../lib/terms';

export const dynamic = 'force-dynamic';

type ClientDetail = {
  id: string; name: string; abn: string | null; status: string; billingContactName: string | null; billingEmail: string | null;
  phone: string | null; notes: string | null;
  facilities: { id: string; name: string; suburb: string | null; state: string | null; active: boolean; areaCount: number }[];
};

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const tw = await words();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [c, agency, settings] = await Promise.all([api<ClientDetail>(`/clients/${id}`), currentAgency(), api<{ country?: string }>('/settings').catch(() => ({ country: 'AU' }))]);
  const home = settings.country ?? 'AU';
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link href="/clients">← Clients</Link></p>
      <h1>{c.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}><Badge label={CLIENT_STATUS[c.status]} />{c.abn && <> · ABN {c.abn}</>}{c.billingEmail && <> · {c.billingEmail}</>}</p>
      <Notices error={sp.error} done={sp.done} />

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>{tw.many(T.site)}</h2>
        {c.facilities.length === 0 ? <p className="muted">No facilities yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Location</th><th>Areas</th></tr></thead>
            <tbody>
              {c.facilities.map(f => (
                <tr key={f.id} style={{ opacity: f.active ? 1 : 0.5 }}>
                  <td><Link href={`/facilities/${f.id}`}>{f.name}</Link></td>
                  <td>{[f.suburb, f.state].filter(Boolean).join(', ') || '—'}</td>
                  <td>{f.areaCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <details style={{ marginTop: 12 }} open={c.facilities.length === 0}>
            <summary style={{ cursor: 'pointer' }}>Add a facility</summary>
            <form action={addFacility.bind(null, c.id)} className="form-row" style={{ marginTop: 12 }}>
              <label>Name<input name="name" required maxLength={200} placeholder="e.g. Northside Private Hospital" /></label>
              <label>Street address<input name="addressLine" maxLength={200} /></label>
              <PlaceFields homeCountry={home} />
              <label>Phone<input name="phone" maxLength={30} /></label>
              <button type="submit" className="btn">Add facility</button>
            </form>
          </details>
        )}
      </div>

      {canEdit && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edit client</summary>
          <form action={updateClient.bind(null, c.id)} className="form-row" style={{ marginTop: 12 }}>
            <label>Name<input name="name" required defaultValue={c.name} maxLength={200} /></label>
            <label>ABN<input name="abn" defaultValue={c.abn ?? ''} maxLength={20} /></label>
            <label>Status
              <select name="status" defaultValue={c.status}>
                <option value="active">Active</option><option value="on_hold">On hold</option><option value="inactive">Inactive</option>
              </select>
            </label>
            <label>Billing contact<input name="billingContactName" defaultValue={c.billingContactName ?? ''} maxLength={200} /></label>
            <label>Billing email<input name="billingEmail" type="email" defaultValue={c.billingEmail ?? ''} maxLength={200} /></label>
            <label>Phone<input name="phone" defaultValue={c.phone ?? ''} maxLength={30} /></label>
            <label style={{ flexBasis: '100%' }}>Notes<textarea name="notes" defaultValue={c.notes ?? ''} maxLength={2000} rows={3} /></label>
            <button type="submit" className="btn">Save</button>
          </form>
        </details>
      )}
    </>
  );
}
