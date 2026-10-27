import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { Badge, COMPLIANCE_LABEL } from '../../../lib/format';
import { Notices } from '../notices';
import { addWorker } from './actions';
import { EMPLOYMENT_LABEL } from './[id]/employment-card';
import { T, words } from '../../../lib/terms';

export const dynamic = 'force-dynamic';

type Worker = {
  id: string; firstName: string; lastName: string; preferredName: string | null; email: string | null; phone: string | null;
  status: string; roles: string[]; compliance: string; issueCount: number;
  employmentType: string | null; contractedHours: number | null;
};

export default async function WorkersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tw = await words();
  const p = await searchParams;
  const qs = new URLSearchParams();
  if (p.search) qs.set('search', p.search);
  if (p.compliance) qs.set('compliance', p.compliance);
  if (p.status) qs.set('status', p.status);
  if (p.employment) qs.set('employment', p.employment);
  const [workers, agency] = await Promise.all([api<Worker[]>(`/workers?${qs}`), currentAgency()]);
  // Employment terms are set by owners and admins.
  const canSetEmployment = agency?.role === 'owner' || agency?.role === 'admin';

  return (
    <>
      <h1>{tw.many(T.worker)}</h1>
      <p className="muted">Everyone who works shifts for the business, how they are employed today, and whether they are compliant to work.</p>
      <Notices error={p.error} done={p.done} />

      <details className="card" open={workers.length === 0 && !p.search && !p.compliance && !p.employment}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add a worker</summary>
        <form action={addWorker} className="form-row" style={{ marginTop: 12 }}>
          <label>First name<input name="firstName" required maxLength={100} /></label>
          <label>Last name<input name="lastName" required maxLength={100} /></label>
          <label>Email<input name="email" type="email" maxLength={200} /></label>
          <label>Mobile<input name="phone" maxLength={30} /></label>
          <label>Roles<input name="roles" placeholder="e.g. RN, EN, AIN" maxLength={200} /></label>
          {canSetEmployment && <>
            <label>Employment
              <select name="employmentType" defaultValue="">
                <option value="">Not yet</option><option value="full_time">Full-time</option><option value="part_time">Part-time</option>
                <option value="casual">Casual</option><option value="bank">Bank (relief pool)</option>
              </select>
            </label>
            <label>Hours a week<input name="contractedHours" type="number" min={0} max={80} step={0.25} placeholder="If set" /></label>
          </>}
          <button type="submit" className="btn">Add worker</button>
        </form>
      </details>

      <form className="card form-row" method="get">
        <label>Search<input name="search" defaultValue={p.search} placeholder="Name, email or phone" /></label>
        <label>Compliance
          <select name="compliance" defaultValue={p.compliance ?? ''}>
            <option value="">Any</option>
            <option value="non_compliant">Not compliant</option>
            <option value="expiring">Expiring</option>
            <option value="compliant">Compliant</option>
          </select>
        </label>
        <label>Status
          <select name="status" defaultValue={p.status ?? ''}>
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="offboarded">Offboarded</option>
          </select>
        </label>
        <label>Employment
          <select name="employment" defaultValue={p.employment ?? ''}>
            <option value="">Any</option>
            {Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="none">Not recorded</option>
          </select>
        </label>
        <button type="submit" className="btn secondary">Filter</button>
      </form>

      <div className="card" style={{ overflowX: 'auto' }}>
        {workers.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No workers found.</p>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Roles</th><th>Employment</th><th>Contact</th><th>Status</th><th>Compliance</th></tr></thead>
            <tbody>
              {workers.map(w => (
                <tr key={w.id}>
                  <td><Link href={`/workers/${w.id}`}>{w.lastName}, {w.firstName}</Link>{w.preferredName && <span className="muted"> ({w.preferredName})</span>}</td>
                  <td>{w.roles.join(', ') || '—'}</td>
                  <td>{w.employmentType ? <>{EMPLOYMENT_LABEL[w.employmentType] ?? w.employmentType}{w.contractedHours !== null && <span className="muted"> · {w.contractedHours} h</span>}</> : <span className="muted">—</span>}</td>
                  <td>{w.email ?? ''}{w.email && w.phone ? <br /> : null}{w.phone ?? ''}</td>
                  <td style={{ textTransform: 'capitalize' }}>{w.status}</td>
                  <td>
                    <Badge label={COMPLIANCE_LABEL[w.compliance]} />
                    {w.issueCount > 0 && <span className="muted"> {w.issueCount} to fix</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
