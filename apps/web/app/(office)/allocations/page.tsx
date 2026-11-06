import Link from 'next/link';
import { api } from '../../../lib/api';
import { businessZone, todayIn, whenIn } from '../../../lib/business';
import { orderPlaces, type ClientContact } from '../../../lib/client-orders';
import { parseQueueParams, queueHref, queueQuery, type QueueParams, type QueueTeam } from '../../../lib/allocation-queue';
import { currentAgency } from '../../../lib/current-user';
import { NewOrderForm, RecentOrders, type ClientOrder } from './client-shifts';
import { QueueScreen, type HistoryRow, type Panel, type PanelCandidate, type PanelOffer, type PanelShift, type Queue, type QueueRow } from './queue';
import type { AgencyFillState } from '../roster/agency-fill-section';
import { T, words, type Words } from '../../../lib/terms';
import { Notices } from '../notices';
import type { CallRow } from '../../../lib/calls';
import { AgencyAttentionList, type AgencyAttention } from './agency-attention';
import { offerToPeople, pullOut, putForward, recordYes, withdrawOffers } from './actions';
import { CustomerRequests } from './customers';
import { hasCustomers, type AllocationSummary } from '../../../lib/client-orders';

export const dynamic = 'force-dynamic';

type Requirement = { name: string; severity: 'hard' | 'warning' | 'optional'; forDuty: string | null; credentialTypeId: string | null };
type Request = {
  id: string; connectionId: string; employerName: string; siteName: string; siteRegion: string | null; areaName: string | null; role: string;
  startsAt: string; when: string; startsIn: string; breakMinutes: number; duties: string[]; requirements: Requirement[]; note: string | null; genderRequested?: 'F' | 'M' | null;
  status: 'open' | 'filled' | 'withdrawn' | 'expired'; receivedAt: string; closedAt: string | null; closedReason: string | null; unmatched: number;
  placedName: string | null; placedByName: string | null; placement: string | null; placementState: string | null;
};

type Reason = { code: string; message: string };
type Person = { workerId: string; name: string; roles: string[]; weekHours: number; available: boolean; eligible: boolean; blocks: Reason[]; warnings: Reason[] };
type People = { ready: number; unmatched: { name: string; severity: string }[]; people: Person[] };
type Offer = { id: string; workerId: string; workerName: string; state: string; expiresAt: string | null; respondedVia: string | null };
const OFFER_STATE: Record<string, string> = { pending: 'waiting for a reply', expired: 'expired', accepted: 'accepted', declined: 'said no', withdrawn: 'withdrawn', filled: 'filled' };

const LEVEL: Record<Requirement['severity'], string> = { hard: 'Must have', warning: 'Should have', optional: 'Optional' };
const GENDER_ASKED = { F: 'A female worker requested', M: 'A male worker requested' } as const;
const CLOSED: Record<string, string> = { filled: 'Filled', withdrawn: 'Withdrawn', expired: 'Expired' };

type Summary = AllocationSummary;
type Site = { id: string; name: string; clientId: string | null; clientName: string | null; active: boolean };

/**
 * Allocations (function code 2200). For a business with clients: the allocation queue (David chose layout A, 2 Nov):
 * client shifts still needing work, most urgent first, with a fill panel beside the one open (`shift=`), stage tabs
 * and office chips (state chips for a business without offices) in the URL; "+ New order" and "Completed and history" are views of their own. For a business that
 * supplies employers on CROP (agency fill), "Requests from employers" lists what employers sent it, with its people
 * checked against each (ready first) to put forward or offer.
 */
export default async function AllocationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [summary, tw, zone, sp] = await Promise.all([api<Summary>('/allocations/summary').catch(() => null), words(), businessZone(), searchParams]);
  const hasAgency = (summary?.agencyLinks ?? 0) > 0;
  const hasClients = Boolean(summary?.hasClients);
  const parsed = parseQueueParams(sp);
  const customers = hasCustomers(summary) || parsed.view === 'customers';
  const p: QueueParams = {
    ...parsed,
    view: parsed.view === 'customers' ? 'customers' : !hasClients && hasAgency ? 'employers' : parsed.view === 'employers' && !hasAgency ? 'queue' : parsed.view,
  };
  const when = whenIn(zone);
  const error = typeof sp.error === 'string' ? sp.error : undefined;
  const done = typeof sp.done === 'string' ? sp.done : undefined;
  const tab = (view: QueueParams['view'], label: string) => (
    <Link className={`q-view${p.view === view ? ' on' : ''}`} href={queueHref({ ...p, shift: null }, { view })} aria-current={p.view === view ? 'page' : undefined}>{label}</Link>
  );
  return (
    <div className="alloc-page">
      <div className="q-header">
        <h1>Allocations</h1>
        {hasClients && hasAgency && (
          <nav className="q-views" aria-label="What to show">
            {tab('queue', `${tw.one(T.client)} ${tw.lower(T.shift, true)}`)}
            {tab('employers', 'Requests from employers')}
          </nav>
        )}
        {(hasClients || customers) && (
          <div className="q-header-right">
            {customers && p.view !== 'customers' && (
              <Link className="btn small secondary" href="/allocations?view=customers">New customers{summary?.customerRequests ? ` (${summary.customerRequests})` : ''}</Link>
            )}
            {hasClients && (p.view === 'queue' ? <Link className="btn small secondary" href={queueHref({ ...p, shift: null }, { view: 'history' })}>Completed and history</Link>
              : <Link className="btn small secondary" href={queueHref({ ...p, shift: null }, { view: 'queue' })}>Back to the queue</Link>)}
            {hasClients && <Link className="btn small" href={queueHref({ ...p, shift: null }, { view: 'new' })}>+ New order</Link>}
          </div>
        )}
      </div>
      <Notices error={error} done={done} />
      {p.view === 'customers' && <CustomerRequests tw={tw} when={when} all={sp.all === '1'} />}
      {!hasClients && !hasAgency && p.view !== 'customers' && (
        <p className="muted">Nothing to allocate yet. Give a {tw.lower(T.site)} a {tw.lower(T.client)} to take their orders here.</p>
      )}
      {hasClients && p.view === 'queue' && <ClientQueue tw={tw} p={p} when={when} today={todayIn(zone)} />}
      {hasClients && p.view === 'new' && <NewOrder tw={tw} today={todayIn(zone)} />}
      {hasClients && p.view === 'history' && (
        <RecentOrders tw={tw} orders={await api<ClientOrder[]>('/client-orders?days=30').catch(() => [] as ClientOrder[])} when={when} />
      )}
      {hasAgency && p.view === 'employers' && <AgencyRequests tw={tw} when={when} />}
    </div>
  );
}

/**
 * The allocation queue and the open shift's panel. Forward-looking periods fetch everything at once, as before; calendar
 * periods (which include ended and cancelled shifts) look at the shift first, so an ended one shows what happened and
 * isn't checked against everyone for filling.
 */
async function ClientQueue({ tw, p, when, today }: { tw: Words; p: QueueParams; when: (iso: string) => string; today: string }) {
  const qs = queueQuery(p);
  if (p.period) {
    const [q, clients, facts, calls] = await Promise.all([
      api<Queue>(`/allocations/queue?${qs}`).catch(() => null),
      api<{ id: string; name: string; status: string }[]>('/clients').catch(() => []),
      p.shift ? api<PanelShift>(`/shifts/${p.shift}`).catch(() => null) : Promise.resolve(null),
      p.shift ? api<CallRow[]>(`/calls?shiftId=${p.shift}&days=90`).catch(() => [] as CallRow[]) : Promise.resolve([] as CallRow[]),
    ]);
    const row: QueueRow | null = q?.shifts.find(r => r.id === p.shift) ?? null;
    const done = facts ? facts.status === 'cancelled' || (facts.endsAt ? new Date(facts.endsAt).getTime() <= Date.now() : false) : false;
    let panel: Panel | null = null;
    if (facts && done) {
      const [offers, history] = await Promise.all([
        api<PanelOffer[]>(`/shifts/${p.shift}/offers`).catch(() => [] as PanelOffer[]),
        api<HistoryRow[]>(`/shifts/${p.shift}/history`).catch(() => [] as HistoryRow[]),
      ]);
      panel = { shift: facts, row, candidates: [], offers, agency: null, calls, today, done: true, history };
    } else if (facts) {
      const [fill, agency, teams] = await Promise.all([
        api<{ shift: PanelShift; candidates: PanelCandidate[]; offers: PanelOffer[] }>(`/shifts/${p.shift}/bank-fill?everyone=true`).catch(() => null),
        api<AgencyFillState>(`/shifts/${p.shift}/agency-fill`).catch(() => null),
        standingTeams(),
      ]);
      panel = fill ? { shift: fill.shift, row, candidates: fill.candidates, offers: fill.offers, agency, calls, today, teams } : null;
    }
    return (
      <QueueScreen tw={tw} p={p} q={q} clients={clients.filter(c => c.status === 'active').sort((a, b) => a.name.localeCompare(b.name))}
        panel={panel} now={Date.now()} when={when} />
    );
  }
  const [q, clients, fill, agency, calls, teams] = await Promise.all([
    api<Queue>(`/allocations/queue?${qs}`).catch(() => null),
    api<{ id: string; name: string; status: string }[]>('/clients').catch(() => []),
    p.shift ? api<{ shift: PanelShift; candidates: PanelCandidate[]; offers: PanelOffer[] }>(`/shifts/${p.shift}/bank-fill?everyone=true`).catch(() => null) : Promise.resolve(null),
    p.shift ? api<AgencyFillState>(`/shifts/${p.shift}/agency-fill`).catch(() => null) : Promise.resolve(null),
    p.shift ? api<CallRow[]>(`/calls?shiftId=${p.shift}&days=14`).catch(() => [] as CallRow[]) : Promise.resolve([] as CallRow[]),
    p.shift ? standingTeams() : Promise.resolve([] as QueueTeam[]),
  ]);
  const row: QueueRow | null = q?.shifts.find(r => r.id === p.shift) ?? null;
  const panel: Panel | null = fill ? { shift: fill.shift, row, candidates: fill.candidates, offers: fill.offers, agency, calls, today, teams } : null;
  return (
    <QueueScreen tw={tw} p={p} q={q} clients={clients.filter(c => c.status === 'active').sort((a, b) => a.name.localeCompare(b.name))}
      panel={panel} now={Date.now()} when={when} />
  );
}

/**
 * The business's standing teams (Workers › Teams) for the fill panel's team choice. Teams are business-wide, so the API
 * refuses them to anyone limited to some sites; they simply get no choice.
 */
async function standingTeams(): Promise<QueueTeam[]> {
  const me = await currentAgency();
  if (!me || me.role === 'supervisor' || me.sites != null) return [];
  return api<{ teams: QueueTeam[] }>('/teams').then(r => r.teams).catch(() => [] as QueueTeam[]);
}

/** "+ New order": the order form, with every client site and area as one choice. */
async function NewOrder({ tw, today }: { tw: Words; today: string }) {
  const [sites, roles, contacts] = await Promise.all([
    api<Site[]>('/facilities').catch(() => [] as Site[]),
    api<{ name: string; active?: boolean }[]>('/roles').catch(() => []),
    api<ClientContact[]>('/client-contacts').catch(() => [] as ClientContact[]),
  ]);
  const clientSites = sites.filter(f => f.clientId && f.active).slice(0, 60);
  const withAreas = await Promise.all(clientSites.map(async f =>
    ({ ...f, areas: (await api<{ areas: { id: string; name: string; active: boolean }[] }>(`/facilities/${f.id}`).catch(() => ({ areas: [] }))).areas })));
  const roleNames = [...new Set(roles.filter(r => r.active !== false).map(r => r.name))].sort();
  return <NewOrderForm tw={tw} places={orderPlaces(withAreas)} roles={roleNames} today={today} contacts={contacts} />;
}

/** Requests from employers on CROP (agency fill), each with this business's people checked against it. */
async function AgencyRequests({ tw, when }: { tw: Words; when: (iso: string) => string }) {
  const [list, attention] = await Promise.all([api<Request[]>('/agency-requests?status=all'), api<AgencyAttention>('/allocations/attention').catch(() => null)]);
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
      <p className="muted">
        {tw.one(T.shift)} requests from the employers you supply, soonest first. Times are the site&apos;s local time.
        Under each request are your {tw.lower(T.worker, true)} who meet the employer&apos;s requirements and your own rules, ready first.
        Put someone forward, or offer it to several and the first to accept goes, and they go onto the employer&apos;s roster (booked straight away, or once the employer approves, as they chose). If they can&apos;t go after all, pull them out before the {shift} starts; you&apos;re emailed when the employer approves, declines or takes them off.
      </p>
      {attention && attention.total > 0 && (
        <details className="card dash-attention" open={attention.urgent > 0 || attention.byKind.person_blocked > 0} aria-label="Needs attention">
          <summary style={{ cursor: 'pointer' }}>
            <strong>Needs attention</strong> <span className="muted">· {attention.total}{attention.urgent > 0 ? <> · <span className="bad">{attention.urgent} within a day</span></> : null}</span>
          </summary>
          <AgencyAttentionList a={attention} shown={20} shiftsWord={tw.lower(T.shift, true)} onAllocations />
        </details>
      )}
      <div className="card">
        <h2>Open ({open.length})</h2>
        {open.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No open requests. When an employer sends you a {shift}, it shows here and your owners and admins get an email.</p>
        ) : open.map(r => (
          <div key={r.id} id={`request-${r.id}`} className="alloc-row" style={{ borderTop: '1px solid var(--line, #e5e5e5)', padding: '10px 0' }}>
            <p style={{ margin: 0 }}>
              <strong>{r.role}</strong> · {r.employerName} · {[r.areaName, r.siteName, r.siteRegion].filter(Boolean).join(', ')}
            </p>
            <p style={{ margin: '2px 0' }}>{r.when}{r.breakMinutes ? ` (${r.breakMinutes} min break)` : ''} <span className="muted">· starts {r.startsIn}</span></p>
            {r.duties.length > 0 && <p className="small" style={{ margin: '2px 0' }}>Duties: {r.duties.join(', ')}</p>}
            {r.genderRequested && <p className="small" style={{ margin: '2px 0' }}>{GENDER_ASKED[r.genderRequested]}</p>}
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
                <tr key={r.id} id={`request-${r.id}`}>
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
