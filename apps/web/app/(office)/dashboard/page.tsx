import Link from 'next/link';
import { api } from '../../../lib/api';
import { barWidth, showValue, standingClass, standingWords, targetLine, type Dashboard as Dash, type Focus, type Kpi } from '../../../lib/dashboard';
import { T, words } from '../../../lib/terms';
import { mondayOf } from '../roster/view';
import { AgencyAttentionList, type AgencyAttention } from '../allocations/agency-attention';

export const dynamic = 'force-dynamic';

type Summary = {
  activeWorkers: number; counts: { compliant: number; expiring: number; non_compliant: number };
  verificationQueue: { id: string; workerId: string; workerName: string; typeName: string; createdAt: string }[];
  expiringSoon: { id: string; workerId: string; workerName: string; typeName: string; expiryDate: string; verification: string }[];
};
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
type Words = Awaited<ReturnType<typeof words>>;

/** How many lines each list on the Dashboard shows; the screen it links to has the rest. */
const SHOWN = 5;
const longDate = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const FOCUSES: Focus[] = ['allocator', 'compliance', 'recruitment', 'overview'];

/**
 * The office's first screen (David, 31 Oct): each person's dashboard is chosen by the owner for their job focus
 * (Allocator, Compliance, Recruitment, or Overview), with the numbers that matter to that work across the top and
 * the lists to act on below. `?focus=` looks at another one.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const tw = await words();
  const sp = await searchParams;
  const wanted = sp.focus && (FOCUSES as string[]).includes(sp.focus) ? sp.focus : null;
  const [dash, facilities, s, types, attention, leave, requests, onboarding, allocations] = await Promise.all([
    api<Dash>(`/dashboard${wanted ? `?focus=${wanted}` : ''}`).catch(() => null),
    api<unknown[]>('/facilities'), api<Summary>('/compliance/summary'), api<unknown[]>('/credential-types'),
    api<Attention>('/roster/attention').catch(() => null),
    api<Leave[]>('/leave?status=requested').catch(() => [] as Leave[]),
    api<ChangeRequest[]>('/roster/change-requests').catch(() => [] as ChangeRequest[]),
    api<Onboarding[]>('/onboardings').catch(() => [] as Onboarding[]),
    api<{ agencyLinks: number }>('/allocations/summary').catch(() => null),
  ]);
  const focus: Focus = dash?.focus ?? 'overview';
  // A business that supplies employers (agency side links) also gets Allocations' Needs attention.
  const agencyAttention = allocations && allocations.agencyLinks > 0 && (focus === 'allocator' || focus === 'overview')
    ? await api<AgencyAttention>('/allocations/attention').catch(() => null) : null;

  const sections = {
    attention: attention && <AttentionSection key="attention" a={attention} tw={tw} />,
    agency: agencyAttention && (
      <section key="agency" className="card dash-attention" style={{ marginTop: 16 }}>
        <h2>Allocations: needs attention</h2>
        <AgencyAttentionList a={agencyAttention} shown={SHOWN} shiftsWord={tw.lower(T.shift, true)} onAllocations={false} />
        <Link href="/allocations">Open Allocations</Link>
      </section>
    ),
    decisions: <Decisions key="decisions" tw={tw} leave={leave} requests={requests} onboarding={onboarding} toCheck={s.verificationQueue.length} />,
    people: <People key="people" tw={tw} s={s} sites={facilities.length} />,
    checking: <CheckQueue key="checking" tw={tw} s={s} />,
    funnel: dash?.funnel && <Funnel key="funnel" f={dash.funnel} />,
    onboarding: <OnboardingList key="onboarding" list={onboarding} tw={tw} />,
  };
  const order: Record<Focus, (keyof typeof sections)[]> = {
    allocator: ['attention', 'agency', 'decisions'],
    compliance: ['checking', 'people', 'attention'],
    recruitment: ['funnel', 'onboarding'],
    overview: ['attention', 'agency', 'decisions', 'people'],
  };

  return (
    <>
      <div className="dash-head">
        <h1>{dash ? `${dash.label} dashboard` : 'Dashboard'}</h1>
        {dash && (
          <nav className="dash-switch" aria-label="Dashboards">
            {dash.focuses.map(f => (
              <Link key={f.focus} href={f.focus === dash.assigned ? '/dashboard' : `/dashboard?focus=${f.focus}`}
                className={f.focus === focus ? 'on' : ''} aria-current={f.focus === focus ? 'page' : undefined}>
                {f.label}{f.focus === dash.assigned ? ' (yours)' : ''}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <p className="muted small">
        {dash && focus === dash.assigned
          ? (dash.assignedByOwner ? 'Your dashboard, chosen by the owner.' : 'The usual dashboard for your role; the owner can choose another for you in Settings.')
          : 'Looking at another dashboard. Yours is marked.'}
      </p>
      {facilities.length === 0 && (
        <div className="notice success">Getting started: add your first {tw.lower(T.site)} in <Link href="/facilities">{tw.many(T.site)}</Link>, then build its {tw.lower(T.roster)}.</div>
      )}
      {facilities.length > 0 && types.length === 0 && (
        <div className="notice success">Getting started: set up {tw.lower(T.credential, true)} in <Link href="/settings">Settings</Link> (an industry template does most of it), then add your <Link href="/workers">{tw.lower(T.worker, true)}</Link>.</div>
      )}
      {dash && dash.kpis.length > 0 && <KpiRow kpis={dash.kpis} />}
      {dash && dash.kpis.some(k => k.target === null) && (
        <p className="muted small">Numbers are marked on or off target once your business sets its own targets in <Link href="/settings/dashboards">Settings › Dashboards</Link>.</p>
      )}
      {order[focus].map(k => sections[k])}
    </>
  );
}

function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="kpi-row">
      {kpis.map(k => (
        <Link key={k.key} href={k.href} className={standingClass(k.standing)} title={`${k.question} ${k.how}.`}>
          <span className="kpi-label">{k.label}</span>
          <span className="kpi-value">{showValue(k.value, k.unit)}</span>
          {standingWords(k.standing) && <span className="kpi-standing">{standingWords(k.standing)}</span>}
          {k.detail && <span className="kpi-detail">{k.detail}</span>}
          {k.breakdown.length > 0 && (
            <span className="kpi-detail">{k.breakdown.slice(0, 3).map(b => `${b.label} ${b.value}`).join(' · ')}</span>
          )}
          <span className="kpi-target">{targetLine(k)}</span>
        </Link>
      ))}
    </div>
  );
}

function AttentionSection({ a, tw }: { a: Attention; tw: Words }) {
  const kinds: { kind: Kind; text: (n: number) => string }[] = [
    { kind: 'person_blocked', text: n => `${plural(n, 'person', 'people')} who can't work their ${tw.lower(T.shift)} now` },
    { kind: 'equipment_blocked', text: n => `${plural(n, tw.lower(T.equipment) + ' booking', tw.lower(T.equipment) + ' bookings')} that can't go ahead` },
    { kind: 'cover_gap', text: n => plural(n, 'cover gap', 'cover gaps') },
    { kind: 'open', text: n => `${plural(n, tw.lower(T.shift), tw.lower(T.shift, true))} with nobody on them` },
    { kind: 'unconfirmed', text: n => `${plural(n, 'person', 'people')} yet to confirm` },
  ];
  return (
    <section className="card dash-attention" style={{ marginTop: 16 }}>
      <h2>Needs attention</h2>
      {a.total === 0 ? (
        <p className="muted">Nothing needs attention in the next {a.days} days.</p>
      ) : (
        <>
          <p>
            {plural(a.total, 'thing', 'things')} in the next {a.days} days
            {a.urgent > 0 && <> · <strong className="bad">{a.urgent} within a day</strong></>}
          </p>
          <ul className="dash-kinds">
            {kinds.filter(k => a.byKind?.[k.kind]).map(k => (
              <li key={k.kind}><span className={`att-kind ${k.kind}`} aria-hidden="true" />{k.text(a.byKind[k.kind])}</li>
            ))}
          </ul>
          <ol>
            {a.items.slice(0, SHOWN).map(i => (
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
          {a.total > SHOWN && <p className="muted small">And {a.total - SHOWN} more on the {tw.lower(T.roster)}; the most pressing are shown first.</p>}
        </>
      )}
      <Link href="/roster">Open the {tw.lower(T.roster)}</Link>
    </section>
  );
}

function Decisions({ tw, leave, requests, onboarding, toCheck }: { tw: Words; leave: Leave[]; requests: ChangeRequest[]; onboarding: Onboarding[]; toCheck: number }) {
  const first = requests[0];
  const ready = onboarding.filter(o => o.summary.ready);
  const firstOnb = ready[0] ?? onboarding[0];
  return (
    <>
      <h2 style={{ marginTop: 24 }}>Waiting on a decision</h2>
      <div className="grid">
        <div className="card"><div className="muted">Leave requests</div><div className="stat">{leave.length}</div><Link href="/leave">Leave</Link></div>
        <div className="card">
          <div className="muted">{tw.one(T.roster)} change requests</div><div className="stat">{requests.length}</div>
          {first ? <Link href={`/roster?week=${first.weekStart}&shift=${first.shiftId}`}>See the first one</Link> : <Link href="/roster">{tw.one(T.roster)}</Link>}
        </div>
        {firstOnb && (
          <div className="card">
            <div className="muted">Being onboarded</div><div className="stat">{onboarding.length}</div>
            {ready.length > 0 && <div className="muted small">{ready.length} ready to finish</div>}
            <Link href={`/workers/${firstOnb.workerId}`}>{ready.length ? `Finish ${firstOnb.workerName}` : `${firstOnb.workerName}: ${firstOnb.summary.done} of ${firstOnb.summary.total} steps`}</Link>
          </div>
        )}
        <div className="card"><div className="muted">{tw.many(T.credential)} waiting for checking</div><div className="stat">{toCheck}</div><Link href="/compliance">Review</Link></div>
      </div>
    </>
  );
}

function People({ tw, s, sites }: { tw: Words; s: Summary; sites: number }) {
  return (
    <>
      <h2 style={{ marginTop: 24 }}>{tw.many(T.worker)}</h2>
      <div className="grid">
        <div className="card"><div className="muted">Active {tw.lower(T.worker, true)}</div><div className="stat">{s.activeWorkers}</div><Link href="/workers">View {tw.lower(T.worker, true)}</Link></div>
        <div className="card"><div className="muted">Not compliant</div><div className="stat" style={{ color: 'var(--bad)' }}>{s.counts.non_compliant}</div><Link href="/workers?compliance=non_compliant">See who</Link></div>
        <div className="card"><div className="muted">Expiring soon</div><div className="stat" style={{ color: 'var(--warn)' }}>{s.counts.expiring}</div><Link href="/compliance">Compliance</Link></div>
        <div className="card"><div className="muted">{tw.many(T.site)}</div><div className="stat">{sites}</div><Link href="/facilities">View {tw.lower(T.site, true)}</Link></div>
      </div>
    </>
  );
}

function CheckQueue({ tw, s }: { tw: Words; s: Summary }) {
  const ago = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000); return d === 0 ? 'today' : `${plural(d, 'day', 'days')} ago`; };
  return (
    <div className="dash-pair">
      <section className="card">
        <h2>Waiting to be checked</h2>
        {s.verificationQueue.length === 0 ? <p className="muted">Nothing waiting: every {tw.lower(T.credential)} sent in has been checked.</p> : (
          <ol className="dash-list">
            {s.verificationQueue.slice(0, SHOWN).map(c => (
              <li key={c.id}><Link href={`/workers/${c.workerId}?tab=credentials`}>{c.workerName}</Link> · {c.typeName} <span className="muted small">· sent {ago(c.createdAt)}</span></li>
            ))}
          </ol>
        )}
        {s.verificationQueue.length > SHOWN && <p className="muted small">And {s.verificationQueue.length - SHOWN} more, oldest first.</p>}
        <Link href="/compliance">Open Compliance</Link>
      </section>
      <section className="card">
        <h2>Running out soon</h2>
        {s.expiringSoon.length === 0 ? <p className="muted">Nothing runs out soon.</p> : (
          <ol className="dash-list">
            {s.expiringSoon.slice(0, SHOWN).map(c => (
              <li key={c.id}><Link href={`/workers/${c.workerId}?tab=credentials`}>{c.workerName}</Link> · {c.typeName} <span className="muted small">· {longDate(c.expiryDate)}</span></li>
            ))}
          </ol>
        )}
        {s.expiringSoon.length > SHOWN && <p className="muted small">And {s.expiringSoon.length - SHOWN} more.</p>}
        <Link href="/compliance">Open Compliance</Link>
      </section>
    </div>
  );
}

function Funnel({ f }: { f: NonNullable<Dash['funnel']> }) {
  const max = Math.max(...f.map(x => x.reached), 0);
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>How applicants move, last 90 days</h2>
      {max === 0 ? <p className="muted">No applicants in the last 90 days. Add them on the <Link href="/recruitment">recruitment board</Link>.</p> : (
        <ol className="funnel">
          {f.map(x => (
            <li key={x.stage}>
              <span className="funnel-label">{x.label}</span>
              <span className="funnel-bar"><span style={{ width: `${barWidth(x.reached, max)}%` }} /></span>
              <span className="funnel-n">{x.reached}</span>
              <span className="muted small funnel-conv">{x.conversion === null ? '' : `${x.conversion}% moved on`}</span>
            </li>
          ))}
        </ol>
      )}
      <Link href="/recruitment">Open the recruitment board</Link>
    </section>
  );
}

function OnboardingList({ list, tw }: { list: Onboarding[]; tw: Words }) {
  const sorted = [...list].sort((a, b) => Number(b.summary.ready) - Number(a.summary.ready) || (b.summary.done / (b.summary.total || 1)) - (a.summary.done / (a.summary.total || 1)));
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Being onboarded</h2>
      {sorted.length === 0 ? <p className="muted">Nobody is being onboarded. Start onboarding from Offer on the recruitment board.</p> : (
        <ol className="dash-list">
          {sorted.slice(0, SHOWN).map(o => (
            <li key={o.id}>
              <Link href={`/workers/${o.workerId}`}>{o.workerName}</Link> · {o.summary.done} of {o.summary.total} steps
              {o.summary.ready && <strong className="ok"> · ready to finish and hand to the {tw.lower(T.roster)}</strong>}
            </li>
          ))}
        </ol>
      )}
      {sorted.length > SHOWN && <p className="muted small">And {sorted.length - SHOWN} more.</p>}
    </section>
  );
}
