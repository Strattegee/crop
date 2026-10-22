import { api } from '../../../lib/api';
import { addFacility } from './actions';

export const dynamic = 'force-dynamic';

type Facility = { id: string; name: string; timezone: string };

const TIMEZONES = [
  ['Australia/Melbourne', 'Victoria (Melbourne)'],
  ['Australia/Sydney', 'New South Wales (Sydney)'],
  ['Australia/Brisbane', 'Queensland (Brisbane)'],
  ['Australia/Adelaide', 'South Australia (Adelaide)'],
  ['Australia/Perth', 'Western Australia (Perth)'],
  ['Australia/Hobart', 'Tasmania (Hobart)'],
  ['Australia/Darwin', 'Northern Territory (Darwin)'],
] as const;

export default async function FacilitiesPage({ searchParams }: { searchParams: Promise<{ error?: string; added?: string }> }) {
  const [facilities, params] = await Promise.all([api<Facility[]>('/facilities'), searchParams]);
  const tzLabel = (tz: string) => TIMEZONES.find(t => t[0] === tz)?.[1] ?? tz;
  return (
    <>
      <h1>Facilities</h1>
      <p className="muted">Hospitals, aged care homes and other sites where your workers do shifts.</p>
      {params.error && <div className="notice error">{params.error}</div>}
      {params.added && <div className="notice success">Added {params.added}.</div>}

      <div className="card">
        <h2>Add a facility</h2>
        <form action={addFacility} className="form-row">
          <label>Name<input name="name" required maxLength={200} placeholder="e.g. Northside Aged Care" /></label>
          <label>Time zone
            <select name="timezone" defaultValue="Australia/Melbourne">
              {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button type="submit" className="btn">Add facility</button>
        </form>
      </div>

      <div className="card">
        {facilities.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No facilities yet.</p>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Time zone</th></tr></thead>
            <tbody>
              {facilities.map(f => <tr key={f.id}><td>{f.name}</td><td>{tzLabel(f.timezone)}</td></tr>)}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
