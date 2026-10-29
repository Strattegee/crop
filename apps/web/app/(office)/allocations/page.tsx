import Link from 'next/link';
import { api } from '../../../lib/api';
import { businessZone, whenIn } from '../../../lib/business';
import { T, words } from '../../../lib/terms';
import { Notices } from '../notices';
import { offerToPeople, pullOut, putForward, recordYes, withdrawOffers } from './actions';

export const dynamic = 'force-dynamic';

type Requirement = { name: string; severity: 'hard' | 'warning' | 'optional'; forDuty: string | null; credentialTypeId: string | null };
type Request = {
  id: string; connectionId: string; employerName: string; siteName: string; siteRegion: string | null; areaName: string | null; role: string;
  startsAt: string; when: string; startsIn: string; breakMinutes: number; duties: string[]; requirements: Requirement[]; note: string | null;
  status: 'open' | 'filled' | 'withdrawn' | 'expired'; receivedAt: string; closedAt: string | null; closedReason: string | null; unmatched: number;
  placedName: string | null; placedByName: string | null; placement: string | null; placementState: string | null;
};

type Reason = { code: string; message: string };
type Person = { workerId: string; name: string; roles: string[]; weekHours: number; available: boolean; eligible: boolean; blocks: Reason[]; warnings: Reason[] };
type People = { ready: number; unmatched: { name: string; severity: string }[]; people: Person[] };
type Offer = { id: string; workerId: string; workerName: string; state: string; expiresAt: string | null; respondedVia: string | null };
const OFFER_STATE: Record<string, string> = { pending: 'waiting for a reply', expired: 'expired', accepted: 'accepted', declined: 'said no', withdrawn: 'withdrawn', filled: 'filled' };

const LEVEL: Record<Requirement['severity'], string> = { hard: 'Must have', warning: 'Should have', optional: 'Optional' };
const CLOSED: Record<string, string> = { filled: 'Filled', withdrawn: 'Withdrawn', expired: 'Expired' };

/**
 * Allocations (function code 2200, agency fill): the requests employers have sent this business, soonest first, with
 * what each needs and this business's people checked against it (ready first), each with Put forward (migration 0042:
 * booked straight away or waiting for the employer's approval, as the employer chose). Closed ones show who went.
 */
export default async function AllocationsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [list, tw, zone, sp] = await Promise.all([api<Request[]>('/agency-requests?status=all'), words(), businessZone(), searchParams]);
  const when = whenIn(zone);
  const open = list.filter(r => r.status === 'open');
  // Each open request's people, checked against the employer's requirements as matched to this business's credentials.
  const people = new Map(await Promise.all(open.map(async r =>
    [r.id, await api<People>(`/agency-requests/${r.id}/people`).catch(() => null)] as const)));
  const offers = new Map(await Promise.all(open.map(async r =>
    [r.id, await api<Offer[]>(`/agency-requests/${r.id}/offers`).catch(() => [])] as const)));
  const closed = list.filter(r => r.status !== 'open');
  const shift = tw.lower(T.shift);
  const now = Date.now();
  return (
    <>
      <h1>Allocations</h1>
      <p className="muted">
        {tw.one(T.shift)} requests from the employers you supply, soonest first. Times are the site&apos;s local time.
        Under each request are your {tw.lower(T.worker, true)} who meet the employer&apos;s requirements and your own rules, ready first.
        Put someone forward, or offer it to several and the first to accept goes, and they go onto the employer&apos;s roster (booked straight away, or once the employer approves, as they chose). If they can&apos;t go after all, pull them out before the {shift} starts; you&apos;re emailed when the employer approves, declines or takes them off.
      </p>
      <Notices error={sp.error} done={sp.done} />
      <div className="card">
        <h2>Open ({open.length})</h2>
        {open.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No open requests. When an employer sends you a {shift}, it shows here and your owners and admins get an email.</p>
        ) : open.map(r => (
          <div key={r.id} className="alloc-row" style={{ borderTop: '1px solid var(--line, #e5e5e5)', padding: '10px 0' }}>
            <p style={{ margin: 0 }}>
              <strong>{r.role}</strong> · {r.employerName} · {[r.areaName, r.siteName, r.siteRegion].filter(Boolean).join(', ')}
            </p>
            <p style={{ margin: '2px 0' }}>{r.when}{r.breakMinutes ? ` (${r.breakMinutes} min break)` : ''} <span className="muted">· starts {r.startsIn}</span></p>
            {r.duties.length > 0 && <p className="small" style={{ margin: '2px 0' }}>Duties: {r.duties.join(', ')}</p>}
            {r.note && <p className="small" style={{ margin: '2px 0' }}>Note from {r.employerName}: {r.note}</p>}
            {r.requirements.length > 0 && (
              <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {r.requirements.map(q => (
                  <li key={`${q.name}-${q.forDuty ?? ''}`}>
                    {LEVEL[q.severity]}: {q.name}{q.forDuty ? ` (for ${q.forDuty})` : ''}
                    {q.severity !== 'optional' && !q.credentialTypeId && <span className="warnline"> ⚠ not matched to your credentials</span>}
                  </li>
                ))}
              </ul>
            )}
            {r.unmatched > 0 && (
              <p className="small" style={{ margin: '4px 0 0' }}>
                <Link href={`/settings/agencies/${r.connectionId}`}>Match {r.employerName}&apos;s requirements</Link> so CROP can check your people against them.
              </p>
            )}
            {(() => {
              const p = people.get(r.id);
              if (!p) return <p className="muted small" style={{ margin: '4px 0 0' }}>Couldn&apos;t check your {tw.lower(T.worker, true)} for this one.</p>;
              const ready = p.people.filter(x => x.eligible);
              const cant = p.people.filter(x => !x.eligible);
              return (
                <div style={{ marginTop: 6 }}>
                  <p className="small" style={{ margin: 0 }}><strong>Ready to go ({ready.length})</strong></p>
                  {ready.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nobody meets the requirements for this {shift}.</p>}
                  {ready.slice(0, 8).map(x => (
                    <div key={x.workerId} className="small panel-row" style={{ alignItems: 'center' }}>
                      <span>
                        <input type="checkbox" name="workerId" value={x.workerId} form={`offer-${r.id}`} aria-label={`Offer to ${x.name}`} style={{ marginRight: 6 }} />
                        <Link href={`/workers/${x.workerId}`}>{x.name}</Link> <span className="muted">· {x.roles.join(', ') || 'no role'} · {x.weekHours} h that week</span>
                        {x.warnings.map(w => <span key={w.message} className="warnline"> ⚠ {w.message}</span>)}
                      </span>
                      <form action={putForward.bind(null, r.id, x.workerId, x.name)}>
                        <button className="btn small secondary" title={`Put ${x.name} on ${r.employerName}'s ${shift}`}>Put forward</button>
                      </form>
                    </div>
                  ))}
                  {ready.length > 8 && <p className="muted small" style={{ margin: 0 }}>and {ready.length - 8} more</p>}
                  {ready.length > 0 && (
                    <form id={`offer-${r.id}`} action={offerToPeople.bind(null, r.id)} className="small" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' }}>
                      <span className="muted">Or tick several and</span>
                      <button className="btn small">Offer to ticked</button>
                      <label className="muted">open for{' '}
                        <select name="expiresInMinutes" defaultValue="0" aria-label="Offer open for">
                          <option value="0">until it starts</option><option value="30">30 minutes</option><option value="60">1 hour</option>
                          <option value="120">2 hours</option><option value="240">4 hours</option>
                        </select>
                      </label>
                      <span className="muted">· each gets an email and text with a link; the first to accept goes.</span>
                    </form>
                  )}
                  {(offers.get(r.id) ?? []).length > 0 && (
                    <div className="small" style={{ margin: '4px 0' }}>
                      <strong>Offered</strong>{' '}
                      {(offers.get(r.id) ?? []).map((o, i) => (
                        <span key={o.id}>
                          {i > 0 && ' · '}{o.workerName} <span className="muted">({OFFER_STATE[o.state] ?? o.state})</span>
                          {o.state === 'pending' && (
                            <form action={recordYes.bind(null, o.id, o.workerName)} style={{ display: 'inline' }}>
                              {' '}<button className="btn small secondary" title={`${o.workerName} told you yes: put them forward`}>They said yes</button>
                            </form>
                          )}
                        </span>
                      ))}
                      {(offers.get(r.id) ?? []).some(o => o.state === 'pending') && (
                        <form action={withdrawOffers.bind(null, r.id)} style={{ display: 'inline' }}>
                          {' '}<button className="btn small secondary">Withdraw offers</button>
                        </form>
                      )}
                    </div>
                  )}
                  {cant.length > 0 && (
                    <details className="small">
                      <summary className="muted" style={{ cursor: 'pointer' }}>Can&apos;t go ({cant.length})</summary>
                      {cant.map(x => <div key={x.workerId} className="blocked"><strong>{x.name}</strong>{x.blocks.map(b => <span key={b.message}>{b.message}</span>)}</div>)}
                    </details>
                  )}
                </div>
              );
            })()}
            <p className="muted small" style={{ margin: '4px 0 0' }}>Received {when(r.receivedAt)}</p>
          </div>
        ))}
      </div>
      {closed.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Closed in the last 30 days</h2>
          <table>
            <thead><tr><th>{tw.one(T.shift)}</th><th>Employer</th><th>When</th><th>Outcome</th></tr></thead>
            <tbody>
              {closed.map(r => (
                <tr key={r.id}>
                  <td>{r.role} · {r.siteName}</td><td>{r.employerName}</td><td>{r.when}</td>
                  <td>
                    {r.placedName ? <><strong>{r.placedName}</strong> · {r.placementState ?? r.placement}{r.placedByName ? <span className="muted"> · put forward by {r.placedByName}</span> : null}</>
                      : <>{CLOSED[r.status] ?? r.status}{r.closedReason ? <span className="muted"> · {r.closedReason}</span> : null}</>}
                    {r.placedName && (r.placement === 'waiting' || r.placement === 'booked') && new Date(r.startsAt).getTime() > now && (
                      <details className="small">
                        <summary style={{ cursor: 'pointer' }}>Pull out</summary>
                        <form action={pullOut.bind(null, r.id, r.placedName, r.employerName)} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          <input name="reason" maxLength={300} placeholder={`Reason for ${r.employerName} (optional, no health details)`} aria-label="Reason" />
                          <button className="btn small secondary" title={`Take ${r.placedName} off ${r.employerName}'s ${shift}`}>Pull {r.placedName} out</button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
