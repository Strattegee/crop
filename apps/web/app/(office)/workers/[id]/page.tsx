import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { Badge, COMPLIANCE_LABEL, CREDENTIAL_STATUS_LABEL, formatDate, PROBLEM_LABEL, VERIFICATION_LABEL } from '../../../../lib/format';
import { Notices } from '../../notices';
import { formatDate as fmt } from '../../../../lib/format';
import { PROOF_LABEL, RTW_ISSUE, RTW_STATUS } from '../../../../lib/right-to-work';
import {
  addCredential, rejectCredential, rejectRightToWork, removeDocument, removeRightToWorkDocument, saveRightToWork, updateCredential, updateWorker,
  uploadDocument, uploadRightToWorkDocument, verifyCredential, verifyRightToWork,
} from '../actions';
import { DocLink } from '../../../../lib/doc-link';
import { AddCredentialForm } from './add-credential-form';
import { EditCredentialForm } from './edit-credential-form';
import { RightToWorkForm } from './right-to-work-form';
import { AvailabilityCard } from './availability-card';
import { EmploymentCard, type EmploymentTerms } from './employment-card';
import { OnboardingCard, type Onboarding } from './onboarding-card';
import { AppAccessCard, type AppAccess } from './app-access-card';
import { T, words } from '../../../../lib/terms';
import type { CardData } from '../../../../lib/person-card';
import { PersonCard } from '../person-card';
import { industryGroups, type PackInfo } from '../../../../lib/industry-groups';
import { RolePicker } from '../role-picker';
import { UploadLinkCard, type UploadLinkInfo } from './upload-link-card';
import { whenIn } from '../../../../lib/business';
import { personTabs, type PersonTab } from '../../../../lib/person-tabs';

export const dynamic = 'force-dynamic';

type Credential = {
  id: string; credentialTypeId: string; typeName: string; number: string | null; notes?: string | null; issuedBy?: string | null; issueDate: string | null; expiryDate: string | null;
  verification: string; status: string; verificationMethod: string | null; verificationUrl: string | null;
  verifiedAt: string | null; verificationNote: string | null; rejectionReason: string | null; evidence: string;
  addedInApp?: boolean; sentByLink?: boolean;
  documents: { id: string; filename: string; contentType?: string; sizeBytes: number }[];
};
type Worker = {
  id: string; firstName: string; lastName: string; preferredName: string | null; email: string | null; phone: string | null;
  gender?: 'F' | 'M' | null; status: string; roles: string[]; compliance: string; credentials: Credential[];
  issues: { typeName: string; severity: string; problem: string }[];
  optional?: { credentialTypeId: string; typeName: string; held: boolean }[];
  notes?: string | null; card?: CardData;
};
type MyShift = {
  id: string; localDate: string; localStart: string; localEnd: string; facilityName: string; areaName: string | null; role: string;
  status: string; assignmentStatus: string | null;
};
const SHIFT_STAGE: Record<string, string> = { assigned: 'Allocated', booked: 'Booked', open: 'Open', cancelled: 'Cancelled' };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
type CredentialType = { id: string; name: string; active: boolean; hasNumber: boolean; hasExpiry: boolean; industries?: string[] };
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
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string; tab?: string }>;
}) {
  const tw = await words();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [w, types, agency, rtw, avail, employment, settings, onboarding, checklists, appAccess] = await Promise.all([
    api<Worker>(`/workers/${id}`), api<CredentialType[]>('/credential-types'), currentAgency(), api<Rtw>(`/workers/${id}/right-to-work`),
    api<Parameters<typeof AvailabilityCard>[0]['a']>(`/workers/${id}/availability`).catch(() => null),
    api<EmploymentTerms[]>(`/workers/${id}/employment?withdrawn=true`).catch(() => null),
    api<{ timezone?: string }>('/settings').catch(() => ({} as { timezone?: string })),
    api<Onboarding>(`/workers/${id}/onboarding`).catch(() => null),
    api<Parameters<typeof OnboardingCard>[0]['checklists']>('/onboarding-checklists').catch(() => []),
    api<AppAccess>(`/workers/${id}/app-access`).catch(() => null),
  ]);
  const [packs, roleList] = await Promise.all([
    api<PackInfo[]>('/industry-packs').catch(() => [] as PackInfo[]),
    api<{ id: string; name: string; active: boolean; industries?: string[] }[]>('/roles').catch(() => []),
  ]);
  const roleGroups = industryGroups(roleList.filter(r => r.active), packs);
  // "Today" in the business's time zone, never the server's.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone || 'Australia/Melbourne' }).format(new Date());
  // Tabs (David, 31 Oct): one record, its parts one click away. The tab lives in the URL so links and Back work.
  const tabs = personTabs({ issues: w.issues, rtwIssue: rtw.issue, onboarding: !!onboarding?.current, words: { credentials: tw.many(T.credential), shifts: tw.many(T.shift) } });
  const tab: PersonTab = tabs.some(t => t.id === sp.tab) ? sp.tab as PersonTab : 'overview';
  const uploadInfo = tab === 'credentials' && w.status !== 'agency'
    ? await api<UploadLinkInfo>(`/workers/${id}/upload-link`).catch(() => null) : null;
  const shifts = tab === 'overview' || tab === 'shifts'
    ? await api<MyShift[]>(`/shifts?from=${addDays(today, tab === 'shifts' ? -28 : 0)}&to=${addDays(today, tab === 'shifts' ? 56 : 28)}&workerId=${id}`).catch(() => [] as MyShift[])
    : [];
  const upcoming = shifts.filter(x => x.localDate >= today && x.status !== 'cancelled');
  const shiftTable = (list: MyShift[]) => list.length === 0 ? <p className="muted" style={{ margin: 0 }}>None.</p> : (
    <table>
      <thead><tr><th>Date</th><th>Time</th><th>{tw.one(T.site)}</th><th>{tw.one(T.role)}</th><th>Stage</th></tr></thead>
      <tbody>{list.map(x => (
        <tr key={x.id}>
          <td><Link href={`/roster?span=day&date=${x.localDate}&shift=${x.id}#shift-panel`}>{dayLabel(x.localDate)}</Link></td>
          <td>{x.localStart}–{x.localEnd}</td>
          <td>{x.facilityName}{x.areaName && <span className="muted"> · {x.areaName}</span>}</td>
          <td>{x.role}</td>
          <td>{SHIFT_STAGE[x.status] ?? x.status}</td>
        </tr>
      ))}</tbody>
    </table>
  );
  const r = rtw.current;
  const canVerify = agency?.role === 'owner' || agency?.role === 'admin';
  const activeTypes = types.filter(t => t.active);
  const typeById = new Map(types.map(t => [t.id, t]));

  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link href="/workers">← {tw.many(T.worker)}</Link></p>
      <PersonCard p={w} today={today} size="full" link={false} />
      <Notices error={sp.error} done={sp.done} />
      <nav className="ptabs" aria-label="Parts of this record">
        {tabs.map(t => (
          <Link key={t.id} href={t.id === 'overview' ? `/workers/${id}` : `/workers/${id}?tab=${t.id}`} aria-current={t.id === tab ? 'page' : undefined}>
            {t.label}{t.flag ? <span className="n" title={t.flagTitle}>{t.flag}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && (<>
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

      {onboarding && (
        <OnboardingCard workerId={id} o={onboarding} checklists={checklists} status={w.status} canDecide={canVerify} contact={{ first: w.preferredName || w.firstName, email: !!w.email, phone: !!w.phone }} timeZone={settings.timezone || 'Australia/Melbourne'} />
      )}

        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Coming up <span className="muted small">(next 4 weeks)</span></h2>
          {shiftTable(upcoming.slice(0, 8))}
          {upcoming.length > 8 && <p className="small" style={{ marginBottom: 0 }}><Link href={`/workers/${id}?tab=shifts`}>All {upcoming.length} {tw.lower(T.shift, true)}</Link></p>}
        </div>
      {appAccess && w.status !== 'agency' && (
        <AppAccessCard workerId={id} a={appAccess} first={w.preferredName || w.firstName} canGive={canVerify} timeZone={settings.timezone || 'Australia/Melbourne'} />
      )}

        {w.notes && <div className="card"><h2>Notes</h2><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{w.notes}</p></div>}
      </>)}
      {tab === 'credentials' && (<>
        {uploadInfo && <UploadLinkCard workerId={id} info={uploadInfo} first={w.preferredName || w.firstName} hasEmail={!!w.email} hasPhone={!!w.phone}
          when={whenIn(settings.timezone || 'Australia/Melbourne')} word={tw.lower(T.credential)} />}
      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>{tw.many(T.credential)}</h2>
        {w.credentials.length === 0 ? <p className="muted">No credentials recorded yet.</p> : (
          <table>
            <thead><tr><th>Credential</th><th>Number</th><th>Expires</th><th>Status</th><th>Evidence</th><th>Verification</th>{canVerify && <th />}</tr></thead>
            <tbody>
              {w.credentials.map(c => (
                <tr key={c.id}>
                  <td>
                    {c.typeName}
                    {c.notes && <div className="muted small">{c.notes}</div>}
                    <EditCredentialForm
                      c={c}
                      hasNumber={typeById.get(c.credentialTypeId)?.hasNumber ?? false}
                      hasExpiry={typeById.get(c.credentialTypeId)?.hasExpiry ?? false}
                      action={updateCredential.bind(null, w.id, c.id)}
                    />
                  </td>
                  <td>{c.number ?? '—'}{c.issuedBy && <div className="muted small">Issued by {c.issuedBy}</div>}</td>
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
                    {c.addedInApp && c.verification === 'unverified' && <div className="muted" style={{ fontSize: 12 }}>Added by them in the app</div>}
                    {c.sentByLink && c.verification === 'unverified' && <div className="muted" style={{ fontSize: 12 }}>Sent by them through their upload link</div>}
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
        <h2>Add a {tw.lower(T.credential)}</h2>
        {activeTypes.length === 0 ? (
          <p className="muted">No credential types are set up yet. <Link href="/settings">Add them in Settings</Link>.</p>
        ) : (
          <AddCredentialForm groups={industryGroups(activeTypes, packs)} action={addCredential.bind(null, w.id)} />
        )}
      </div>

      {(w.optional?.length ?? 0) > 0 && (
        <div className="card">
          <h2>Optional</h2>
          <p className="muted small" style={{ marginTop: 0 }}>Useful to have. Never checked and never stops anyone working.</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {w.optional!.map(o => (
              <li key={o.credentialTypeId}>{o.typeName}: <span className="muted">{o.held ? 'has one' : 'not recorded'}</span></li>
            ))}
          </ul>
        </div>
      )}


      </>)}
      {tab === 'rtw' && (<>
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
      </>)}
      {tab === 'employment' && (<>
      {employment && <EmploymentCard workerId={id} terms={employment} today={today} canEdit={canVerify} />}

      </>)}
      {tab === 'availability' && (<>
      {avail && <AvailabilityCard workerId={id} a={avail} canApprove={canVerify} />}

      </>)}
      {tab === 'shifts' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>{tw.many(T.shift)} <span className="muted small">(last 4 weeks and next 8)</span></h2>
          {shiftTable(shifts)}
        </div>
      )}
      {tab === 'details' && (<>
      <div className="card">
        <h2>Details</h2>
        <form action={updateWorker.bind(null, w.id)} className="form-row" style={{ marginTop: 12 }}>
          <label>First name<input name="firstName" required defaultValue={w.firstName} maxLength={100} /></label>
          <label>Last name<input name="lastName" required defaultValue={w.lastName} maxLength={100} /></label>
          <label>Preferred name<input name="preferredName" defaultValue={w.preferredName ?? ''} maxLength={100} /></label>
          <label>Email<input name="email" type="email" defaultValue={w.email ?? ''} maxLength={200} /></label>
          <label>Mobile<input name="phone" defaultValue={w.phone ?? ''} maxLength={30} /></label>
          <label>Gender <span className="muted">(optional)</span>
            <select name="gender" defaultValue={w.gender ?? ''}>
              <option value="">Not recorded</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
            </select>
          </label>
          <RolePicker groups={roleGroups} current={w.roles} label={tw.many(T.role)} />
          <label>Status
            <select name="status" defaultValue={w.status}>
              <option value="active">Active</option>
              <option value="onboarding">Onboarding (not rostered yet)</option>
              <option value="inactive">Inactive</option>
              <option value="offboarded">Offboarded</option>
            </select>
          </label>
          <label style={{ flexBasis: '100%' }}>Notes <span className="muted">(for the office; never shown to the person or sent in messages)</span>
            <textarea name="notes" defaultValue={w.notes ?? ''} maxLength={2000} rows={4} style={{ width: '100%' }} />
          </label>
          <button type="submit" className="btn">Save</button>
        </form>
      </div>
      </>)}
    </>
  );
}
