import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { Badge, COMPLIANCE_LABEL, CREDENTIAL_STATUS_LABEL, formatDate, PROBLEM_LABEL, VERIFICATION_LABEL } from '../../../../lib/format';
import { Notices } from '../../notices';
import { addCredential, rejectCredential, updateWorker, verifyCredential } from '../actions';

export const dynamic = 'force-dynamic';

type Credential = {
  id: string; typeName: string; number: string | null; issueDate: string | null; expiryDate: string | null;
  verification: string; status: string; verificationMethod: string | null; verificationUrl: string | null;
  verifiedAt: string | null; verificationNote: string | null; rejectionReason: string | null; evidence: string;
};
type Worker = {
  id: string; firstName: string; lastName: string; preferredName: string | null; email: string | null; phone: string | null;
  status: string; roles: string[]; compliance: string; credentials: Credential[];
  issues: { typeName: string; severity: string; problem: string }[];
};
type CredentialType = { id: string; name: string; active: boolean; hasNumber: boolean; hasExpiry: boolean };

export default async function WorkerPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [w, types, agency] = await Promise.all([
    api<Worker>(`/workers/${id}`), api<CredentialType[]>('/credential-types'), currentAgency(),
  ]);
  const canVerify = agency?.role === 'owner' || agency?.role === 'admin';
  const activeTypes = types.filter(t => t.active);

  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link href="/workers">← Workers</Link></p>
      <h1>{w.firstName} {w.lastName}{w.preferredName && <span className="muted"> ({w.preferredName})</span>}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {w.roles.join(', ') || 'No roles yet'} · <span style={{ textTransform: 'capitalize' }}>{w.status}</span> · <Badge label={COMPLIANCE_LABEL[w.compliance]} />
      </p>
      <Notices error={sp.error} done={sp.done} />

      {w.issues.length > 0 && (
        <div className="card">
          <h2>To be compliant</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {w.issues.map(i => (
              <li key={`${i.typeName}-${i.problem}`}>
                {i.typeName}: {PROBLEM_LABEL[i.problem] ?? i.problem}
                {i.severity === 'warning' && <span className="muted"> (warning only)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Credentials</h2>
        {w.credentials.length === 0 ? <p className="muted">No credentials recorded yet.</p> : (
          <table>
            <thead><tr><th>Credential</th><th>Number</th><th>Expires</th><th>Status</th><th>Verification</th>{canVerify && <th />}</tr></thead>
            <tbody>
              {w.credentials.map(c => (
                <tr key={c.id}>
                  <td>{c.typeName}</td>
                  <td>{c.number ?? '—'}</td>
                  <td>{formatDate(c.expiryDate)}</td>
                  <td><Badge label={CREDENTIAL_STATUS_LABEL[c.status]} /></td>
                  <td>
                    <Badge label={VERIFICATION_LABEL[c.verification]} />
                    {c.verification === 'verified' && c.verifiedAt && <div className="muted" style={{ fontSize: 12 }}>{formatDate(c.verifiedAt)}{c.verificationNote ? ` · ${c.verificationNote}` : ''}</div>}
                    {c.verification === 'rejected' && <div className="muted" style={{ fontSize: 12 }}>{c.rejectionReason}</div>}
                  </td>
                  {canVerify && (
                    <td style={{ minWidth: 220 }}>
                      {c.verification !== 'verified' && (
                        <details>
                          <summary style={{ cursor: 'pointer' }}>Verify or reject</summary>
                          {c.verificationMethod && <p className="muted" style={{ fontSize: 13 }}>How: {c.verificationMethod}{c.verificationUrl && <> · <a href={c.verificationUrl} target="_blank" rel="noreferrer">open register</a></>}</p>}
                          <form action={verifyCredential.bind(null, w.id, c.id)} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                            <input name="note" placeholder="Note (optional)" maxLength={500} style={{ flex: 1 }} />
                            <button className="btn small" type="submit">Verify</button>
                          </form>
                          <form action={rejectCredential.bind(null, w.id, c.id)} style={{ display: 'flex', gap: 6 }}>
                            <input name="reason" placeholder="Reason" required maxLength={500} style={{ flex: 1 }} />
                            <button className="btn small secondary" type="submit">Reject</button>
                          </form>
                        </details>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ fontSize: 13 }}>Document uploads are coming next. For now, record the details and verify against the original.</p>
      </div>

      <div className="card">
        <h2>Add a credential</h2>
        {activeTypes.length === 0 ? (
          <p className="muted">No credential types are set up yet. <Link href="/settings">Add them in Settings</Link>.</p>
        ) : (
          <form action={addCredential.bind(null, w.id)} className="form-row">
            <label>Credential
              <select name="credentialTypeId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {activeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>Number<input name="number" maxLength={100} /></label>
            <label>Issued<input name="issueDate" type="date" /></label>
            <label>Expires<input name="expiryDate" type="date" /></label>
            <button type="submit" className="btn">Add</button>
          </form>
        )}
      </div>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edit details</summary>
        <form action={updateWorker.bind(null, w.id)} className="form-row" style={{ marginTop: 12 }}>
          <label>First name<input name="firstName" required defaultValue={w.firstName} maxLength={100} /></label>
          <label>Last name<input name="lastName" required defaultValue={w.lastName} maxLength={100} /></label>
          <label>Preferred name<input name="preferredName" defaultValue={w.preferredName ?? ''} maxLength={100} /></label>
          <label>Email<input name="email" type="email" defaultValue={w.email ?? ''} maxLength={200} /></label>
          <label>Mobile<input name="phone" defaultValue={w.phone ?? ''} maxLength={30} /></label>
          <label>Roles<input name="roles" defaultValue={w.roles.join(', ')} maxLength={200} /></label>
          <label>Status
            <select name="status" defaultValue={w.status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="offboarded">Offboarded</option>
            </select>
          </label>
          <button type="submit" className="btn">Save</button>
        </form>
      </details>
    </>
  );
}
