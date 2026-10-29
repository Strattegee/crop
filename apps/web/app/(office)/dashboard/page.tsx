import Link from 'next/link';
import { api } from '../../../lib/api';
import { T, words } from '../../../lib/terms';
import { mondayOf } from '../roster/view';
import { AgencyAttentionList, type AgencyAttention } from '../allocations/agency-attention';

export const dynamic = 'force-dynamic';

type Summary = { activeWorkers: number; counts: { compliant: number; expiring: number; non_compliant: number }; verificationQueue: unknown[] };
type Kind = 'person_blocked' | 'equipment_blocked' | 'cover_gap' | 'open' | 'unconfirmed';
type Attention = {
  days: number; total: number; urgent: number; truncated: boolean; byKind: Record<Kind, number>;
  items: {
    shiftId: string; kind: Kind; urgent: boolean; title: string; detail: string; startsIn: string;
    shift: { facilityName: string; areaName: string | null; role: string; localDate: string; localStart: string; localEnd: string };
  }[];
};
type ChangeRequest = { id: string; weekStart: string; shiftId: string };
type Leave = { id: string };
type Onboarding = { id: string; workerId: string; workerName: string; summary: { done: number; total: number; ready: boolean } };

/** How many lines of Needs attention the Dashboard shows; the roster has the rest. */
const SHOWN = 5;
const longDate = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The office's first screen: what needs them in the coming week, decisions waiting, then their people. */
export default async function Dashboard() {
  const tw = await words();
  const [facilities, s, types, attention, leave, requests, onboarding, allocations] = await Promise.all([
    api<unknown[]>('/facilities'), api<Summary>('/compliance/summary'), api<unknown[]>('/credential-types'),
    api<Attention>('/roster/attention').catch(() => null),
    api<Leave[]>('/leave?status=requested').catch(() => [] as Leave[]),
    api<ChangeRequest[]>('/roster/change-requests').catch(() => [] as ChangeRequest[]),
    api<Onboarding[]>('/onboardings').catch(() => [] as Onboarding[]),
    api<{ agencyLinks: number }>('/allocations/summary').catch(() => null),
  ]);
  // A business that supplies employers (agency side links) also gets Allocations' Needs attention.
  const agencyAttention = allocations && allocations.agencyLinks > 0
    ? await api<AgencyAttention>('/allocations/attention').catch(() => null) : null;
  const shiftsWord = tw.lower(T.shift, true);
  const kinds: { kind: Kind; text: (n: number) => string }[] = [
    { kind: 'person_blocked', text: n => `${plural(n, 'person', 'people')} who can't work their ${tw.lower(T.shift)} now` },
    { kind: 'equipment_blocked', text: n => `${plural(n, tw.lower(T.equipment) + ' booking', tw.lower(T.equipment) + ' bookings')} that can't go ahead` },
    { kind: 'cover_gap', text: n => plural(n, 'cover gap', 'cover gaps') },
    { kind: 'open', text: n => `${plural(n, tw.lower(T.shift), shiftsWord)} with nobody on them` },
    { kind: 'unconfirmed', text: n => `${plural(n, 'person', 'people')} yet to confirm` },
  ];
  const firstRequest = requests[0];
  return (
    <>
      <h1>Dashboard</h1>
      <p className="muted">What needs you in the coming week, decisions waiting on you, then your {tw.lower(T.worker, true)}.</p>
      {facilities.length === 0 && (
        <div className="notice success">Getting started: add your first {tw.lower(T.site)} in <Link href="/facilities">{tw.many(T.site)}</Link>, then build its {tw.lower(T.roster)}.</div>
      )}
      {facilities.length > 0 && types.length === 0 && (
        <div className="notice success">Getting started: set up {tw.lower(T.credential, true)} in <Link href="/settings">Settings</Link> (an industry template does most of it), then add your <Link href="/workers">{tw.lower(T.worker, true)}</Link>.</div>
      )}

      {attention && (
        <section className="card dash-attention" style={{ marginTop: 16 }}>
          <h2>Needs attention</h2>
          {attention.total === 0 ? (
            <p className="muted">Nothing needs attention in the next {attention.days} days.</p>
          ) : (
            <>
              <p>
                {plural(attention.total, 'thing', 'things')} in the next {attention.days} days
                {attention.urgent > 0 && <> · <strong className="bad">{attention.urgent} within a day</strong></>}
              </p>
              <ul className="dash-kinds">
                {kinds.filter(k => attention.byKind?.[k.kind]).map(k => (
                  <li key={k.kind}><span className={`att-kind ${k.kind}`} aria-hidden="true" />{k.text(attention.byKind[k.kind])}</li>
                ))}
              </ul>
              <ol>
                {attention.items.slice(0, SHOWN).map(i => (
                  <li key={`${i.shiftId}:${i.kind}:${i.title}`}>
                    <span className={`att-kind ${i.kind}`} aria-hidden="true" />
                    <span>
                      <strong>{i.title}</strong> <span className="muted">· {i.detail}</span>
                      <br />
                      <Link href={`/roster?week=${mondayOf(i.shift.localDate)}&shift=${i.shiftId}#shift-panel`} target="_blank" rel="noopener" title="Opens in a new tab">
                        {longDate(i.shift.localDate)} {i.shift.localStart}–{i.shift.localEnd} {i.shift.role}
                      </Link>
                      <span className="muted"> · {i.shift.facilityName}</span>
                      {i.shift.areaName && <span className="muted"> · {i.shift.areaName}</span>}
                      <span className={i.urgent ? 'bad small' : 'muted small'}> · {i.startsIn}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {attention.total > SHOWN && <p className="muted small">And {attention.total - SHOWN} more on the {tw.lower(T.roster)}; the most pressing are shown first.</p>}
            </>
          )}
          <Link href="/roster">Open the {tw.lower(T.roster)}</Link>
        </section>
      )}

      {agencyAttention && (
        <section className="card dash-attention" style={{ marginTop: 16 }}>
          <h2>Allocations: needs attention</h2>
          <AgencyAttentionList a={agencyAttention} shown={SHOWN} shiftsWord={shiftsWord} onAllocations={false} />
          <Link href="/allocations">Open Allocations</Link>
        </section>
      )}

      <h2 style={{ marginTop: 24 }}>Waiting on a decision</h2>
      <div className="grid">
        <div className="card"><div className="muted">Leave requests</div><div className="stat">{leave.length}</div><Link href="/leave">Leave</Link></div>
        <div className="card">
          <div className="muted">{tw.one(T.roster)} change requests</div><div className="stat">{requests.length}</div>
          {firstRequest
            ? <Link href={`/roster?week=${firstRequest.weekStart}&shift=${firstRequest.shiftId}`}>See the first one</Link>
            : <Link href="/roster">{tw.one(T.roster)}</Link>}
        </div>
        {onboarding.length > 0 && (() => {
          const ready = onboarding.filter(o => o.summary.ready);
          const first = ready[0] ?? onboarding[0];
          return (
            <div className="card">
              <div className="muted">Being onboarded</div><div className="stat">{onboarding.length}</div>
              {ready.length > 0 && <div className="muted small">{plural(ready.length, 'ready to finish', 'ready to finish')}</div>}
              <Link href={`/workers/${first.workerId}`}>{ready.length ? `Finish ${first.workerName}` : `${first.workerName}: ${first.summary.done} of ${first.summary.total} steps`}</Link>
            </div>
          );
        })()}
        <div className="card"><div className="muted">{tw.many(T.credential)} waiting for checking</div><div className="stat">{s.verificationQueue.length}</div><Link href="/compliance">Review</Link></div>
      </div>

      <h2 style={{ marginTop: 24 }}>{tw.many(T.worker)}</h2>
      <div className="grid">
        <div className="card"><div className="muted">Active {tw.lower(T.worker, true)}</div><div className="stat">{s.activeWorkers}</div><Link href="/workers">View {tw.lower(T.worker, true)}</Link></div>
        <div className="card"><div className="muted">Not compliant</div><div className="stat" style={{ color: 'var(--bad)' }}>{s.counts.non_compliant}</div><Link href="/workers?compliance=non_compliant">See who</Link></div>
        <div className="card"><div className="muted">Expiring soon</div><div className="stat" style={{ color: 'var(--warn)' }}>{s.counts.expiring}</div><Link href="/compliance">Compliance</Link></div>
        <div className="card"><div className="muted">{tw.many(T.site)}</div><div className="stat">{facilities.length}</div><Link href="/facilities">View {tw.lower(T.site, true)}</Link></div>
      </div>
    </>
  );
}
