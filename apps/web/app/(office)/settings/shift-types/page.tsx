import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { addShiftType, saveShiftType, setShiftTypeActive } from './actions';

export const dynamic = 'force-dynamic';

type ShiftType = {
  id: string; facilityId: string | null; facilityName: string | null; code: string; name: string | null; letter: string | null;
  startTime: string; endTime: string; breakMinutes: number; active: boolean;
};
type Facility = { id: string; name: string; active: boolean };

/** Paid hours for a shift type, allowing for overnight shifts. */
function paidHours(t: ShiftType) {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  let len = m(t.endTime) - m(t.startTime);
  if (len <= 0) len += 24 * 60;
  return Math.round(((len - t.breakMinutes) / 60) * 100) / 100;
}

/** Shift types (function 9100): the business's usual shifts, each with a letter for the roster, a name and standard hours. */
export default async function ShiftTypesPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; edit?: string }> }) {
  const tw = await words();
  const [types, facilities, agency, sp] = await Promise.all([
    api<ShiftType[]>('/shift-codes'), api<Facility[]>('/facilities'), currentAgency(), searchParams,
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const sites = facilities.filter(f => f.active);
  const editing = canEdit && sp.edit ? types.find(t => t.id === sp.edit) : undefined;

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>Shift types</h1>
      <p className="muted">The shifts your business usually works, such as D, Day shift, 7:00–3:30, or AM, PM and NS on a ward. Pick one when you add {tw.lower(T.shift, true)} to the {tw.lower(T.roster)} and its hours fill in. The letter shows on each {tw.lower(T.shift)} on the {tw.lower(T.roster)}; without one, the {tw.lower(T.roster)} shows A, P or N from the start time.</p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can change shift types.</div>}

      {editing && (
        <div className="card">
          <h2>Change {editing.code}</h2>
          <form action={saveShiftType.bind(null, editing.id)} className="form-row">
            <label>Letter<input name="letter" defaultValue={editing.letter ?? ''} maxLength={3} placeholder="e.g. D" /></label>
            <label>Name<input name="name" defaultValue={editing.name ?? ''} maxLength={60} /></label>
            <label>Start<input name="startTime" type="time" defaultValue={editing.startTime} required /></label>
            <label>End<input name="endTime" type="time" defaultValue={editing.endTime} required /></label>
            <label>Break (minutes)<input name="breakMinutes" type="number" min={0} max={240} defaultValue={editing.breakMinutes} /></label>
            <button type="submit" className="btn">Save</button>
            <Link href="/settings/shift-types" className="btn secondary">Cancel</Link>
          </form>
          <p className="muted small" style={{ marginBottom: 0 }}>Leave the letter blank to show A, P or N from the start time.</p>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        {types.length === 0 ? (
          <p className="muted">No shift types yet. Add one below, or apply an industry template in <Link href="/settings">Settings</Link> to start with a set.</p>
        ) : (
          <table>
            <thead><tr><th>Letter</th><th>Code</th><th>Name</th><th>Hours</th><th>Break</th><th>Paid hours</th><th>{tw.one(T.site)}</th><th /></tr></thead>
            <tbody>
              {types.map(t => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                  <td><b className="type-letter">{t.letter ?? '—'}</b></td>
                  <td>{t.code}{!t.active && ' (off)'}</td>
                  <td>{t.name ?? '—'}</td>
                  <td>{t.startTime}–{t.endTime}</td>
                  <td>{t.breakMinutes} min</td>
                  <td>{paidHours(t)}</td>
                  <td>{t.facilityName ?? `All ${tw.lower(T.site, true)}`}</td>
                  <td>
                    {canEdit && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Link href={`/settings/shift-types?edit=${t.id}`} className="btn small secondary">Change</Link>
                        <form action={setShiftTypeActive.bind(null, t.id, !t.active)}>
                          <button type="submit" className="btn small secondary">{t.active ? 'Switch off' : 'Switch on'}</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>Changing the hours only affects {tw.lower(T.shift, true)} added afterwards; {tw.lower(T.shift, true)} already on the {tw.lower(T.roster)} keep their times.</p>
      </div>

      {canEdit && (
        <div className="card">
          <h2>Add a shift type</h2>
          <form action={addShiftType} className="form-row">
            <label>Letter<input name="letter" maxLength={3} placeholder="e.g. D" /></label>
            <label>Code<input name="code" required maxLength={12} placeholder="e.g. DAY" /></label>
            <label>Name<input name="name" maxLength={60} placeholder="e.g. Day shift" /></label>
            <label>Start<input name="startTime" type="time" required /></label>
            <label>End<input name="endTime" type="time" required /></label>
            <label>Break (minutes)<input name="breakMinutes" type="number" min={0} max={240} defaultValue={30} /></label>
            <label>{tw.one(T.site)}
              <select name="facilityId" defaultValue="">
                <option value="">All {tw.lower(T.site, true)}</option>
                {sites.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <button type="submit" className="btn">Add</button>
          </form>
        </div>
      )}
    </>
  );
}
