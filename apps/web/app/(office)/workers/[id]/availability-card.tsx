import { addLeave, clearDate, saveDate, savePattern } from './availability-actions';

type Periods = string[];
type Availability = {
  from: string; to: string;
  pattern: { weekday: number; periods: Periods }[];
  dates: { date: string; periods: Periods; note: string | null }[];
  leave: { id: string; kind: string; startsOn: string; endsOn: string; days: number; status: string; note: string | null }[];
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OPTIONS: [string, string][] = [
  ['', 'Not said'], ['any', 'Any time'], ['am', 'AM only'], ['pm', 'PM only'], ['night', 'Nights only'],
  ['ampm', 'AM and PM'], ['pmnight', 'PM and nights'], ['none', 'Not available'],
];
const KIND: Record<string, string> = { annual: 'Annual leave', personal: 'Personal leave', long_service: 'Long service leave', unpaid: 'Unpaid leave', other: 'Other leave' };
const STATUS: Record<string, string> = { requested: 'Requested', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };
function choiceOf(p: Periods | undefined) {
  if (!p) return '';
  const k = [...p].sort().join(',');
  return ({ '': 'none', 'am,night,pm': 'any', am: 'am', pm: 'pm', night: 'night', 'am,pm': 'ampm', 'night,pm': 'pmnight' } as Record<string, string>)[k] ?? 'any';
}
function describe(p: Periods) {
  return OPTIONS.find(([k]) => k === choiceOf(p))?.[1] ?? p.join(', ');
}
const d = (s: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));

/** Availability and leave on a person's page (backlog item 10). */
export function AvailabilityCard({ workerId, a, canApprove }: { workerId: string; a: Availability; canApprove: boolean }) {
  const byDay = new Map(a.pattern.map(p => [p.weekday, p.periods]));
  return (
    <div className="card">
      <h2>Availability and leave</h2>
      <p className="muted" style={{ marginTop: 0 }}>The roster warns when someone is rostered outside their availability, and blocks approved leave. AM starts 5am–midday, PM midday–7pm, nights from 7pm.</p>

      <h3 style={{ fontSize: 15 }}>Usual week</h3>
      <form action={savePattern.bind(null, workerId)} className="avail-week">
        {DAYS.map((name, i) => (
          <label key={name}>{name}
            <select name={`day-${i + 1}`} defaultValue={choiceOf(byDay.get(i + 1))}>
              {OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        ))}
        <button className="btn small">Save usual week</button>
      </form>

      <h3 style={{ fontSize: 15 }}>Changes on particular dates</h3>
      {a.dates.length === 0 ? <p className="muted small">None coming up.</p> : (
        <table className="compact">
          <tbody>
            {a.dates.map(x => (
              <tr key={x.date}>
                <td>{d(x.date)}</td><td>{describe(x.periods)}</td><td className="muted">{x.note ?? ''}</td>
                <td><form action={clearDate.bind(null, workerId, x.date)}><button className="btn small secondary">Remove</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form action={saveDate.bind(null, workerId)} className="form-row">
        <label>Date<input name="date" type="date" required /></label>
        <label>Available
          <select name="choice" defaultValue="none">{OPTIONS.filter(([k]) => k).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label>Note <span className="muted">(optional)</span><input name="note" maxLength={300} placeholder="e.g. uni exam" /></label>
        <button className="btn small secondary">Save date</button>
      </form>

      <h3 style={{ fontSize: 15 }}>Leave</h3>
      {a.leave.length === 0 ? <p className="muted small">No leave coming up.</p> : (
        <table className="compact">
          <tbody>
            {a.leave.map(l => (
              <tr key={l.id}>
                <td>{d(l.startsOn)}{l.endsOn !== l.startsOn && ` – ${d(l.endsOn)}`} <span className="muted">({l.days} day{l.days === 1 ? '' : 's'})</span></td>
                <td>{KIND[l.kind] ?? l.kind}</td>
                <td><span className={`badge ${l.status === 'approved' ? 'ok' : 'warn'}`}>{STATUS[l.status] ?? l.status}</span></td>
                <td className="muted">{l.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form action={addLeave.bind(null, workerId)} className="form-row">
        <label>Type
          <select name="kind" defaultValue="annual">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label>From<input name="startsOn" type="date" required /></label>
        <label>To<input name="endsOn" type="date" /></label>
        <label>Note <span className="muted">(optional)</span><input name="note" maxLength={300} /></label>
        {canApprove
          ? <label className="inline"><input type="checkbox" name="approved" defaultChecked />Approved</label>
          : <span className="muted small">Recorded as a request for an owner or admin to approve.</span>}
        <button className="btn small secondary">Record leave</button>
      </form>
      <p className="muted small" style={{ marginBottom: 0 }}>Approve or decline requests on the <a href="/leave">Leave</a> page.</p>
    </div>
  );
}
