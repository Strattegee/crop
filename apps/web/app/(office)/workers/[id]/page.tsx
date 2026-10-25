import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { Badge, COMPLIANCE_LABEL, CREDENTIAL_STATUS_LABEL, formatDate, PROBLEM_LABEL, VERIFICATION_LABEL } from '../../../../lib/format';
import { Notices } from '../../notices';
import { formatDate as fmt } from '../../../../lib/format';
import { PROOF_LABEL, RTW_ISSUE, RTW_STATUS } from '../../../../lib/right-to-work';
import {
  addCredential, rejectCredential, rejectRightToWork, removeDocument, removeRightToWorkDocument, saveRightToWork, updateWorker,
  uploadDocument, uploadRightToWorkDocument, verifyCredential, verifyRightToWork,
} from '../actions';
import { DocLink } from '../../../../lib/doc-link';
import { AddCredentialForm } from './add-credential-form';
import { RightToWorkForm } from './right-to-work-form';

export const dynamic = 'force-dynamic';

type Credential = {
  id: string; typeName: string; number: string | null; issueDate: string | null; expiryDate: string | null;
  verification: string; status: string; verificationMethod: string | null; verificationUrl: string | null;
  verifiedAt: string | null; verificationNote: string | null; rejectionReason: string | null; evidence: string;
  documents: { id: string; filename: string; contentType?: string; sizeBytes: number }[];
};
type Worker = {
  id: string; firstName: string; lastName: string; preferredName: string | null; email: string | null; phone: string | null;
  status: string; roles: string[]; compliance: string; credentials: Credential[];
  issues: { typeName: string; severity: string; problem: string }[];
};
type CredentialType = { id: string; name: string; active: boolean; hasNumber: boolean; hasExpiry: boolean };
type Rtw = {
  current: null | {
    id: string; status: string; citizenProofType: string | null; documentNumber: string | null; visaType: string | null; visaSubclass: string | null;
    visaGrantNumber: string | null; visaExpiry: string | null; workLimit: string | null; workHoursPerFortnight: number | null;
    vevoCheckedOn: string | null; vevoResult: string | null; verification: string; verifiedAt: string | null; verificationNote: string | null;
    rejectionReason: string | null; documents: { id: string; filename: string; contentType?: string; sizeBytes: number }[];
  };
  issue: string | null;
  history: unknown[];
};

export default async function WorkerPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [w, types, agency, rtw] = await Promise.all([
    api<Worker>(`/workers/${id}`), api<CredentialType[]>('/credential-types'), currentAgency(), api<Rtw>(`/workers/${id}/right-to-work`),
  ]);
  const r = rtw.current;
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


      <div className="card">
        <h2>Right to work</h2>
        {r ? (
          <>
            <p style={{ marginTop: 0 }}>
              <strong>{RTW_STATUS[r.status]}</strong>
              {r.status === 'citizen' && r.citizenProofType && <> · {PROOF_LABEL[r.citizenProofType]}{r.documentNumber && ` ${r.documentNumber}`}</>}
              {r.status === 'nz_citizen' && r.documentNumber && <> · NZ passport {r.documentNumber}</>}
              {r.status === 'visa_holder' && <> · {r.visaType} ({r.visaSubclass}) · expires {fmt(r.visaExpiry)} · {r.workLimit === 'limited' ? `limited to ${r.workHoursPerFortnight} hours a fortnight` : 'no work limit'}</>}
              {r.visaGrantNumber && <> · grant {r.visaGrantNumber}</>}
              {r.vevoCheckedOn && <> · VEVO {r.vevoResult === 'confirmed' ? 'confirmed' : 'not confirmed'} on {fmt(r.vevoCheckedOn)}</>}
            </p>
            <p style={{ margin: '0 0 8px' }}>
              <Badge label={VERIFICATION_LABEL[r.verification]} />
              {rtw.issue && <span className="muted"> {RTW_ISSUE[rtw.issue]}</span>}
              {r.verification === 'rejected' && r.rejectionReason && <span className="muted"> · {r.rejectionReason}</span>}
            </p>
            <div style={{ marginBottom: 8 }}>
              {r.documents.map(d => (
                <div key={d.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                  <DocLink href={`/workers/${w.id}/rtw-documents/${d.id}`} filename={d.filename} contentType={d.contentType} />
                  <span className="muted">{Math.max(1, Math.round(d.sizeBytes / 1024))} KB</span>
                  <form action={removeRightToWorkDocument.bind(null, w.id, d.id)}>
                    <button type="submit" className="btn small secondary" style={{ padding: '0 6px' }} aria-label={`Remove ${d.filename}`}>×</button>
                  </form>
                </div>
              ))}
              <form action={uploadRightToWorkDocument.bind(null, w.id)} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/heic" style={{ fontSize: 13, padding: 4 }} />
                <button type="submit" className="btn small secondary">Upload document</button>
              </form>
            </div>
            {canVerify && r.verification !== 'verified' && (
              <div className="form-row" style={{ marginBottom: 8 }}>
                <form action={verifyRightToWork.bind(null, w.id)} style={{ display: 'flex', gap: 6 }}>
                  <input name="note" placeholder="Note (optional)" maxLength={500} />
                  <button className="btn small" type="submit">Verify</button>
                </form>
                <form action={rejectRightToWork.bind(null, w.id)} style={{ display: 'flex', gap: 6 }}>
                  <input name="reason" placeholder="Reason" required maxLength={500} />
                  <button className="btn small secondary" type="submit">Reject</button>
                </form>
              </div>
            )}
            <details>
              <summary style={{ cursor: 'pointer' }}>Update right to work</summary>
              <p className="muted" style={{ fontSize: 13 }}>Saving new details keeps the current ones in the history. The new details need their documents and verifying again.</p>
              <RightToWorkForm action={saveRightToWork.bind(null, w.id)} current={r} />
            </details>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>Not recorded yet. Every worker needs this before they can work.</p>
            <RightToWorkForm action={saveRightToWork.bind(null, w.id)} current={null} />
          </>
        )}
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Credentials</h2>
        {w.credentials.length === 0 ? <p className="muted">No credentials recorded yet.</p> : (
          <table>
            <thead><tr><th>Credential</th><th>Number</th><th>Expires</th><th>Status</th><th>Evidence</th><th>Verification</th>{canVerify && <th />}</tr></thead>
            <tbody>
              {w.credentials.map(c => (
                <tr key={c.id}>
                  <td>{c.typeName}</td>
                  <td>{c.number ?? '—'}</td>
                  <td>{formatDate(c.expiryDate)}</td>
                  <td><Badge label={CREDENTIAL_STATUS_LABEL[c.status]} /></td>
                  <td style={{ minWidth: 200 }}>
                    {c.documents.map(d => (
                      <div key={d.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                        <DocLink href={`/workers/${w.id}/documents/${c.id}/${d.id}`} filename={d.filename} contentType={d.contentType} />
                        <span className="muted">{Math.max(1, Math.round(d.sizeBytes / 1024))} KB</span>
                        <form action={removeDocument.bind(null, w.id, c.id, d.id)}>
                          <button type="submit" className="btn small secondary" style={{ padding: '0 6px' }} aria-label={`Remove ${d.filename}`}>×</button>
                        </form>
                      </div>
                    ))}
                    {c.documents.length === 0 && <Badge label={['Missing', 'neutral']} />}
                    <form action={uploadDocument.bind(null, w.id, c.id)} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/heic" style={{ fontSize: 12, maxWidth: 170, padding: 4 }} />
                      <button type="submit" className="btn small secondary">Upload</button>
                    </form>
                  </td>
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
        <p className="muted" style={{ fontSize: 13 }}>Upload a PDF or photo of each credential (up to 10 MB). Files are stored privately in Australia and open through a link that lasts 5 minutes.</p>
      </div>

      <div className="card">
        <h2>Add a credential</h2>
        {activeTypes.length === 0 ? (
          <p className="muted">No credential types are set up yet. <Link href="/settings">Add them in Settings</Link>.</p>
        ) : (
          <AddCredentialForm types={activeTypes} action={addCredential.bind(null, w.id)} />
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
