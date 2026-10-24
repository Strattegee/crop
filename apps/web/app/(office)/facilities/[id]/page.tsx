import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { SPECIALTIES, STATES } from '../../../../lib/places';
import { Notices } from '../../notices';
import { addArea, setAreaActive, updateFacility } from '../../clients/actions';

export const dynamic = 'force-dynamic';

type Facility = {
  id: string; name: string; clientId: string | null; clientName: string | null; addressLine: string | null; suburb: string | null;
  state: string | null; postcode: string | null; timezone: string; phone: string | null; parkingNotes: string | null; entryNotes: string | null;
  areas: { id: string; name: string; specialty: string | null; active: boolean }[];
};

export default async function FacilityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [f, agency] = await Promise.all([api<Facility>(`/facilities/${id}`), currentAgency()]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const address = [f.addressLine, f.suburb, [f.state, f.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return (
    <>
      <p style={{ margin: '0 0 8px' }}>{f.clientId ? <Link href={`/clients/${f.clientId}`}>← {f.clientName}</Link> : <Link href="/facilities">← Facilities</Link>}</p>
      <h1>{f.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{address || 'No address yet'} · {f.timezone.replace('Australia/', '')} time{f.phone && <> · {f.phone}</>}</p>
      <Notices error={sp.error} done={sp.done} />

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Areas (wards and units)</h2>
        {f.areas.length === 0 ? <p className="muted">No areas yet. Shifts are booked into an area, so add at least one.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Specialty</th><th /></tr></thead>
            <tbody>
              {f.areas.map(a => (
                <tr key={a.id} style={{ opacity: a.active ? 1 : 0.5 }}>
                  <td>{a.name}{!a.active && ' (closed)'}</td>
                  <td>{a.specialty ?? '—'}</td>
                  <td>{canEdit && (
                    <form action={setAreaActive.bind(null, f.id, a.id, !a.active)}>
                      <button className="btn small secondary" type="submit">{a.active ? 'Close' : 'Reopen'}</button>
                    </form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <form action={addArea.bind(null, f.id)} className="form-row" style={{ marginTop: 12 }}>
            <label>Area name<input name="name" required maxLength={120} placeholder="e.g. Ward 3 North" /></label>
            <label>Specialty
              <input name="specialty" list="specialties" maxLength={80} placeholder="e.g. Aged Care" />
              <datalist id="specialties">{SPECIALTIES.map(s => <option key={s} value={s} />)}</datalist>
            </label>
            <button type="submit" className="btn">Add area</button>
          </form>
        )}
      </div>

      {(f.parkingNotes || f.entryNotes) && (
        <div className="card">
          <h2>For workers</h2>
          {f.parkingNotes && <p><strong>Parking:</strong> {f.parkingNotes}</p>}
          {f.entryNotes && <p style={{ marginBottom: 0 }}><strong>Entry and security:</strong> {f.entryNotes}</p>}
        </div>
      )}

      {canEdit && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edit facility</summary>
          <form action={updateFacility.bind(null, f.id)} className="form-row" style={{ marginTop: 12 }}>
            <label>Name<input name="name" required defaultValue={f.name} maxLength={200} /></label>
            <label>Street address<input name="addressLine" defaultValue={f.addressLine ?? ''} maxLength={200} /></label>
            <label>Suburb<input name="suburb" defaultValue={f.suburb ?? ''} maxLength={100} /></label>
            <label>State<select name="state" defaultValue={f.state ?? 'VIC'}>{STATES.map(s => <option key={s}>{s}</option>)}</select></label>
            <label>Postcode<input name="postcode" defaultValue={f.postcode ?? ''} maxLength={4} inputMode="numeric" /></label>
            <label>Phone<input name="phone" defaultValue={f.phone ?? ''} maxLength={30} /></label>
            <label style={{ flexBasis: '100%' }}>Parking notes<textarea name="parkingNotes" defaultValue={f.parkingNotes ?? ''} maxLength={1000} rows={2} /></label>
            <label style={{ flexBasis: '100%' }}>Entry and security notes<textarea name="entryNotes" defaultValue={f.entryNotes ?? ''} maxLength={1000} rows={2} /></label>
            <button type="submit" className="btn">Save</button>
          </form>
        </details>
      )}
    </>
  );
}
