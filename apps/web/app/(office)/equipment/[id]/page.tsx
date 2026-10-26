import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { Notices } from '../../notices';
import { addCheck, setStatus } from '../actions';
import { EQ_STATUS, STATE } from '../labels';

export const dynamic = 'force-dynamic';

type Detail = {
  id: string; name: string; assetNumber: string | null; registration: string | null; status: string; notes: string | null;
  typeName: string; operatorCredentialName: string | null; homeFacilityName: string | null; checkState: string;
  checks: { name: string; dueOn: string; notes: string | null; state: string }[];
  history: { id: string; name: string; dueOn: string; supersededAt: string }[];
  upcomingBookings: { id: string; facilityName: string; role: string; localDate: string; localStart: string; localEnd: string }[];
};
const d = (s: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));
const SUGGEST = ['Registration', 'Service', 'Inspection', 'Electrical test and tag', 'Insurance'];

export default async function EquipmentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [e, agency] = await Promise.all([api<Detail>(`/equipment/${id}`), currentAgency()]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  return (
    <>
      <p style={{ margin: 0 }}><Link href="/equipment">← All equipment</Link></p>
      <h1>{e.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {e.typeName}{e.assetNumber && ` · asset ${e.assetNumber}`}{e.registration && ` · rego ${e.registration}`}{e.homeFacilityName && ` · home ${e.homeFacilityName}`}
        {e.operatorCredentialName && <><br />Operator must hold a verified, current {e.operatorCredentialName}.</>}
      </p>
      <Notices error={sp.error} done={sp.done} />
      <div className="card">
        <h2>Status</h2>
        <form action={setStatus.bind(null, e.id)} className="form-row">
          <label>Status
            <select name="status" defaultValue={e.status} disabled={!canEdit}>{Object.entries(EQ_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          {canEdit && <button className="btn small secondary">Save</button>}
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>Out of service or retired equipment can&apos;t be booked. Bookings already made stay listed below so you can move them.</p>
      </div>
      <div className="card">
        <h2>Dates that must stay current</h2>
        {e.checks.length === 0 ? <p className="muted">None recorded yet.</p> : (
          <table className="compact"><tbody>
            {e.checks.map(c => (
              <tr key={c.name}><td><strong>{c.name}</strong></td><td>{d(c.dueOn)}</td><td><span className={`badge ${STATE[c.state]?.cls}`}>{STATE[c.state]?.label}</span></td><td className="muted">{c.notes ?? ''}</td></tr>
            ))}
          </tbody></table>
        )}
        {canEdit && (
          <form action={addCheck.bind(null, e.id)} className="form-row">
            <label>What<input name="name" required maxLength={60} list="check-names" placeholder="e.g. Service" /></label>
            <datalist id="check-names">{SUGGEST.map(s => <option key={s} value={s} />)}</datalist>
            <label>Due by<input name="dueOn" type="date" required /></label>
            <label>Notes <span className="muted">(optional)</span><input name="notes" maxLength={500} /></label>
            <button className="btn small secondary">Save date</button>
          </form>
        )}
        {e.history.length > 0 && (
          <details><summary className="muted" style={{ cursor: 'pointer' }}>Earlier dates ({e.history.length})</summary>
            <ul>{e.history.map(h => <li key={h.id}>{h.name}: {d(h.dueOn)}</li>)}</ul>
          </details>
        )}
      </div>
      <div className="card">
        <h2>Booked on ({e.upcomingBookings.length})</h2>
        {e.upcomingBookings.length === 0 ? <p className="muted" style={{ margin: 0 }}>No upcoming shifts.</p> : (
          <table className="compact"><tbody>
            {e.upcomingBookings.map(b => (
              <tr key={b.id}><td>{d(b.localDate)}</td><td>{b.localStart}–{b.localEnd}</td><td>{b.role}</td><td className="muted">{b.facilityName}</td>
                <td><Link href={`/roster?week=${b.localDate}&shift=${b.id}`}>Open on roster</Link></td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
