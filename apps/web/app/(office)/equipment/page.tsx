import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { T, words } from '../../../lib/terms';
import { Notices } from '../notices';
import { addEquipment, addType } from './actions';
import { EQ_STATUS, STATE } from './labels';

export const dynamic = 'force-dynamic';

type Check = { name: string; dueOn: string; state: string };
type Equip = { id: string; name: string; assetNumber: string | null; registration: string | null; status: string; typeName: string; operatorCredentialName: string | null; homeFacilityName: string | null; checkState: string; checks: Check[] };
type EType = { id: string; name: string; active: boolean; operatorCredentialName?: string | null };
type CredType = { id: string; name: string; active: boolean };
type Facility = { id: string; name: string; active: boolean };
const d = (s: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));

/** The equipment register (backlog item 4): machines, vehicles and tools, with the dates that must stay current. */
export default async function EquipmentPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; all?: string }> }) {
  const tw = await words();
  const sp = await searchParams;
  const [list, types, creds, sites, agency] = await Promise.all([
    api<Equip[]>(`/equipment${sp.all ? '?status=retired' : ''}`), api<EType[]>('/equipment-types'), api<CredType[]>('/credential-types'),
    api<Facility[]>('/facilities'), currentAgency(),
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const activeTypes = types.filter(t => t.active);
  return (
    <>
      <h1>{tw.many(T.equipment)}</h1>
      <p className="muted">Machines, vehicles and tools. Book them onto shifts from the roster. Overdue dates block bookings; the daily office email lists dates coming up.</p>
      <Notices error={sp.error} done={sp.done} />
      {canEdit && (
        <details className="card" open={list.length === 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add {tw.lower(T.equipment)}</summary>
          {activeTypes.length === 0 ? <p className="muted">Add an equipment type first (below), or apply an industry template in Settings.</p> : (
            <form action={addEquipment} className="form-row" style={{ marginTop: 12 }}>
              <label>Type<select name="equipmentTypeId" required>{activeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label>Name<input name="name" required maxLength={80} placeholder="e.g. Excavator 2" /></label>
              <label>Asset number <span className="muted">(optional)</span><input name="assetNumber" maxLength={40} /></label>
              <label>Registration <span className="muted">(optional)</span><input name="registration" maxLength={20} /></label>
              <label>Home site <span className="muted">(optional)</span>
                <select name="homeFacilityId" defaultValue=""><option value="">None</option>{sites.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </label>
              <button className="btn">Add</button>
            </form>
          )}
        </details>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        {list.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing registered yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Asset / rego</th><th>Home site</th><th>Status</th><th>Dates</th></tr></thead>
            <tbody>
              {list.map(e => (
                <tr key={e.id}>
                  <td><Link href={`/equipment/${e.id}`}>{e.name}</Link></td>
                  <td>{e.typeName}{e.operatorCredentialName && <div className="muted small">Operator needs {e.operatorCredentialName}</div>}</td>
                  <td>{[e.assetNumber, e.registration].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{e.homeFacilityName ?? '—'}</td>
                  <td>{EQ_STATUS[e.status] ?? e.status}</td>
                  <td>
                    {e.checks.length === 0 ? <span className="muted">None recorded</span> : <span className={`badge ${STATE[e.checkState]?.cls}`}>{STATE[e.checkState]?.label}</span>}
                    {e.checks.filter(c => c.state !== 'ok').map(c => <div key={c.name} className="muted small">{c.name}: {d(c.dueOn)}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small" style={{ marginBottom: 0 }}>{sp.all ? <Link href="/equipment">Show equipment in use</Link> : <Link href="/equipment?all=1">Show retired equipment</Link>}</p>
      </div>
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Equipment types ({types.length})</summary>
        <ul style={{ margin: '10px 0' }}>{types.map(t => <li key={t.id}>{t.name}{t.operatorCredentialName && <span className="muted"> · operator needs {t.operatorCredentialName}</span>}{!t.active && <span className="muted"> (not in use)</span>}</li>)}</ul>
        {canEdit && (
          <form action={addType} className="form-row">
            <label>New type<input name="name" required maxLength={80} placeholder="e.g. Scissor lift" /></label>
            <label>Operator must hold <span className="muted">(optional)</span>
              <select name="operatorCredentialTypeId" defaultValue=""><option value="">Nothing special</option>{creds.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <button className="btn small secondary">Add type</button>
          </form>
        )}
      </details>
    </>
  );
}
