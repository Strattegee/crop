import Link from 'next/link';
import { T, type Words } from '../../../lib/terms';
import {
  DAY_CHOICES, QUEUE_BANDS, officeChipList, QUEUE_TABS, bandTitle, bestPeople, releasableRows, hereLine, initials, personLine, queueHref, stagePill, startsIn, tabLabel, waitingFor,
  type QueueBand, type QueueParams, type QueueStage, type QueueTab, type QueueWords,
} from '../../../lib/allocation-queue';
import { clientConfirmLine, dayLabel, findStaffHref, rankChip } from '../../../lib/client-orders';
import { assign, clientConfirmed, confirm, offer, recordReply, unassign, undoClientConfirmed } from '../roster/actions';
import { AgencyFillSection, type AgencyFillState } from '../roster/agency-fill-section';
import { offerFromQueue, releaseMany } from './actions';
import { QueueLive } from './queue-live';

export type QueueRow = {
  id: string; facilityId: string; facilityName: string; region: string | null; officeName?: string | null; areaName: string | null; role: string; status: string;
  startsAt: string; localDate: string; localStart: string; localEnd: string; dayLabel: string; hours: number; genderRequested: 'F' | 'M' | null; notes: string | null;
  clientId: string; clientName: string; clientRank: number | null; clientConfirms: boolean;
  orderId: string | null; clientReference: string | null; channelWords: string | null; requestedByName: string | null; orderNotes: string | null;
  workerId: string | null; workerName: string | null; clientConfirmedAt: string | null;
  offersTotal: number; offersPending: number; offersDeclined: number; pulledOutName: string | null; withAgencies: boolean;
  waitingSince: string | null; stage: QueueStage; band: QueueBand; progress: string; presence: { name: string; initials: string }[]; youAreOn: boolean;
};
export type Queue = {
  counts: Record<QueueTab, number>; regions: { name: string; count: number }[];
  office?: string | null; myOffices?: string[]; offices?: { id: string; name: string; count: number; mine: boolean }[]; noOffice?: number; bands: Record<QueueBand, number>; total: number; shifts: QueueRow[];
};
type Reason = { code: string; message: string };
export type PanelCandidate = { workerId: string; name: string; weekHours: number; eligible: boolean; available: boolean; blocks: Reason[]; warnings: Reason[]; offer?: { id: string; status: string } | null;
  siteHistory?: { shiftsHere: number; lastHere: string | null } };
export type PanelOffer = { id: string; workerId: string; workerName?: string; name?: string; status: string; respondedVia?: string | null };
export type PanelShift = {
  id: string; facilityId: string; facilityName: string; areaName: string | null; role: string; status: string; localDate: string; localStart: string; localEnd: string;
  startsAt: string; hours: number; workerName: string | null; assignmentStatus: string | null; agencyName: string | null; notes: string | null; genderRequested: 'F' | 'M' | null;
  clientConfirms?: boolean; clientConfirmedAt?: string | null; clientConfirmedBy?: string | null; offersPending: number; pulledOutName: string | null;
};
export type Panel = { shift: PanelShift; row: QueueRow | null; candidates: PanelCandidate[]; offers: PanelOffer[]; agency: AgencyFillState | null };

const GENDER = { F: 'Female requested', M: 'Male requested' } as const;

/**
 * Allocations, layout A (David, 2 Nov): one queue of client shifts still needing work, banded by how soon they start,
 * with a fill panel for the open one (`shift=` in the URL). Built for speed: ~20 rows on a laptop, keyboard shortcuts,
 * refreshed every 20 seconds. Nothing is locked; the API decides when two people act at once.
 */
export function QueueScreen({ tw, p, q, clients, panel, now, when }: {
  tw: Words; p: QueueParams; q: Queue | null; clients: { id: string; name: string }[]; panel: Panel | null; now: number; when: (iso: string) => string;
}) {
  const qw: QueueWords = { client: tw.one(T.client), worker: tw.one(T.worker), bank: tw.lower(T.bank), shifts: tw.lower(T.shift, true) };
  const href = (c: Partial<QueueParams>) => queueHref(p, c);
  const here = href({});
  const officeChips = q ? officeChipList({ office: q.office ?? null, myOffices: q.myOffices ?? [], offices: q.offices ?? [], noOffice: q.noOffice ?? 0 }) : [];
  const bands = QUEUE_BANDS.map(b => ({ band: b, rows: (q?.shifts ?? []).filter(r => r.band === b) })).filter(b => b.rows.length);
  return (
    <div className="q-screen">
      <div className="q-filters">
        <form action="/allocations" className="q-selects">
          {p.stage !== 'all' && <input type="hidden" name="stage" value={p.stage} />}
          {p.office && <input type="hidden" name="office" value={p.office} />}
          {p.region && <input type="hidden" name="region" value={p.region} />}
          <label className="sr-only" htmlFor="q-client">{tw.one(T.client)}</label>
          <select id="q-client" name="clientId" defaultValue={p.clientId ?? ''} className="q-select">
            <option value="">Every {tw.lower(T.client)}</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="q-days">Days ahead</label>
          <select id="q-days" name="days" defaultValue={String(p.days)} className="q-select">
            {DAY_CHOICES.map(d => <option key={d} value={d}>{d === 1 ? 'Next 24 hours' : `Next ${d} days`}</option>)}
          </select>
          <button className="btn small secondary">Show</button>
        </form>
        {officeChips.length > 0 && (
          <nav className="q-chips" aria-label="Office">
            <span className="muted small">Office:</span>
            {officeChips.map(c => (
              <Link key={c.value ?? 'default'} className={`q-chip${c.on ? ' on' : ''}`} href={href({ office: c.value, region: null, shift: null })} scroll={false}
                aria-current={c.on ? 'true' : undefined}>{c.label}{c.count !== null && <> <b>{c.count}</b></>}</Link>
            ))}
          </nav>
        )}
        {officeChips.length === 0 && (q?.regions.length ?? 0) > 0 && (
          <nav className="q-chips" aria-label="Region">
            <span className="muted small">Region:</span>
            <Link className={`q-chip${p.region ? '' : ' on'}`} href={href({ region: null, shift: null })} scroll={false}>All</Link>
            {q!.regions.map(r => (
              <Link key={r.name} className={`q-chip${p.region === r.name ? ' on' : ''}`} href={href({ region: r.name, shift: null })} scroll={false}>{r.name} <b>{r.count}</b></Link>
            ))}
          </nav>
        )}
        <QueueLive closeHref={href({ shift: null })} shiftId={p.shift} />
      </div>
      <nav className="q-tabs" aria-label="Stage">
        {QUEUE_TABS.map(t => (
          <Link key={t} className={`q-tab${p.stage === t ? ' on' : ''}`} href={href({ stage: t, shift: null })} scroll={false} aria-current={p.stage === t ? 'page' : undefined}>
            <span className={`q-dot qd-${t}`} aria-hidden="true" />{tabLabel(t, qw)} <b>{q?.counts[t] ?? 0}</b>
          </Link>
        ))}
      </nav>

      <div className={`q-main${panel ? ' with-panel' : ''}`}>
        <section className="q-list" aria-label={tw.many(T.shift)}>
          <div className="q-scroll">
            <div className="q-table" role="table">
              <div className="q-row q-head" role="row">
                <span>Starts in</span><span>Waiting</span><span>Stage</span><span title={`${tw.one(T.client)} rank, 1 = most loyal`}>Rank</span>
                <span>{tw.one(T.client)} · {tw.lower(T.site)} · {tw.lower(T.area)}</span><span>{tw.one(T.role)}</span><span>When</span><span>Hrs</span><span>Progress</span><span title="Who else has it open">On</span>
              </div>
              {!q && <p className="q-empty">Couldn&apos;t load the {qw.shifts}. It tries again in a moment.</p>}
              {q && q.shifts.length === 0 && (
                <p className="q-empty">{p.stage === 'booked_today' ? `Nothing booked today yet${p.region ? ` in ${p.region}` : ''}.` : `Nothing needs anyone here. New orders show up as soon as they're saved.`}</p>
              )}
              {bands.map(b => (
                <div key={b.band} role="rowgroup">
                  <div className={`q-band qb-${b.band}`} role="row">
                    <span>{bandTitle(b.band)} <b>{b.rows.length}</b></span>
                    {(b.band === 'soon' || b.band === 'started') && <span className="q-band-hint">soonest first; higher-ranked {tw.lower(T.client, true)} first at the same time</span>}
                    <BulkRelease tw={tw} qw={qw} rows={releasableRows(b.rows)} here={here} title={bandTitle(b.band).toLowerCase()} />
                  </div>
                  {b.rows.map(r => {
                    const st = startsIn(r.startsAt, now, r);
                    const pill = stagePill(r.stage, qw);
                    const rank = rankChip(r.clientRank);
                    const sel = p.shift === r.id;
                    return (
                      <Link key={r.id} href={href({ shift: sel ? null : r.id })} scroll={false} data-qrow role="row"
                        className={`q-row${sel ? ' sel' : ''}${r.stage === 'pulled_out' ? ' q-pulled' : ''}`} aria-current={sel ? 'true' : undefined}>
                        <span className={`q-starts ${st.tone}`}>{st.text}</span>
                        <span className="muted">{waitingFor(r.waitingSince, now)}</span>
                        <span><span className={`q-pill ${pill.cls}`}>{pill.label}</span></span>
                        <span>{rank ? <span className={`q-rank${(r.clientRank ?? 9) <= 2 ? ' top' : ''}`} title={`${tw.one(T.client)} rank`}>{r.clientRank}</span> : <span className="muted">–</span>}</span>
                        <span className="cut">{r.clientName} · {r.facilityName}{r.areaName ? ` · ${r.areaName}` : ''}</span>
                        <span className="cut">{r.role}{r.genderRequested ? <span className="muted"> ({r.genderRequested})</span> : null}</span>
                        <span className="cut muted">{r.dayLabel} {r.localStart}–{r.localEnd}</span>
                        <span className="muted">{r.hours}</span>
                        <span className="cut muted" title={r.progress}>{r.progress}</span>
                        <span className="q-on">{r.presence.slice(0, 2).map(x => <span key={x.name} className="q-av" title={`${x.name} has this open`}>{x.initials}</span>)}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="q-foot">
            <span><kbd>J</kbd> <kbd>K</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>A</kbd> assign top person</span>
            <span><kbd>O</kbd> offer to top 5</span><span><kbd>R</kbd> release to {qw.bank}</span><span><kbd>Esc</kbd> close</span>
            <span className="q-foot-count">{q ? `${q.total} ${q.total === 1 ? tw.lower(T.shift) : qw.shifts}` : ''} · nothing is locked: if two people act, the first wins and the other is told</span>
          </div>
        </section>
        {panel && <FillPanel tw={tw} qw={qw} panel={panel} here={here} closeHref={href({ shift: null })} now={now} when={when} />}
      </div>
    </div>
  );
}

/**
 * "Release N new": offers every New shift in a band to everyone who can work it, in one press (layout C's release in
 * bulk, inside the queue). Opens a small confirm first (`data-hold` stops the 20-second refresh while it's open).
 */
function BulkRelease({ tw, qw, rows, here, title }: { tw: Words; qw: QueueWords; rows: { id: string }[]; here: string; title: string }) {
  if (rows.length < 2) return null;
  const n = `${rows.length} ${qw.shifts}`;
  return (
    <details className="q-bulk" data-hold>
      <summary>Release {rows.length} new</summary>
      <form action={releaseMany} className="q-bulk-pop">
        <input type="hidden" name="back" value={here} />
        {rows.map(r => <input key={r.id} type="hidden" name="shiftId" value={r.id} />)}
        <p>Offer the {n} still new in <strong>{title}</strong> to everyone who can work each one, as its own Release button would.</p>
        <p className="muted small">Each person gets a message for every {tw.lower(T.shift)} they can work; the first to accept each one gets it. Any that someone fills meanwhile are skipped.</p>
        <button className="btn small">Release {n} to the {qw.bank}</button>
      </form>
    </details>
  );
}

function FillPanel({ tw, qw, panel, here, closeHref, now, when }: {
  tw: Words; qw: QueueWords; panel: Panel; here: string; closeHref: string; now: number; when: (iso: string) => string;
}) {
  const { shift: s, row: r } = panel;
  const shift = tw.lower(T.shift), client = tw.lower(T.client);
  const st = startsIn(s.startsAt, now, { dayLabel: r?.dayLabel ?? '', localStart: s.localStart });
  const meta = [r?.clientReference ? `ref ${r.clientReference}` : null, r?.channelWords ? `asked by ${r.channelWords.toLowerCase()}${r.requestedByName ? ` (${r.requestedByName})` : ''}` : null,
    r?.clientRank ? `rank ${r.clientRank} ${client}` : null, s.clientConfirms ? 'confirms each booking' : null].filter(Boolean).join(' · ');
  const best = bestPeople(panel.candidates, 5, s.status === 'open' ? s.pulledOutName : null);
  const canWork = bestPeople(panel.candidates, 50, s.pulledOutName).length;
  const pending = panel.offers.filter(o => o.status === 'pending');
  const declined = panel.offers.filter(o => o.status === 'declined').length;
  const open = s.status === 'open';
  const cc = clientConfirmLine(s, client, when);
  const back = <input type="hidden" name="back" value={here} />;
  const pill = r ? stagePill(r.stage, qw) : null;
  return (
    <aside className="q-panel" id="fill-panel" aria-label={`Selected ${shift}`}>
      <div className="q-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          {meta && <div className="muted small">{meta}</div>}
          <h2>{s.role}</h2>
          <div>{r?.clientName ? `${r.clientName} – ` : ''}{s.facilityName}{s.areaName ? `, ${s.areaName}` : ''}</div>
          <div className="muted small">{dayLabel(s.localDate)} · {s.localStart}–{s.localEnd} · {s.hours}&nbsp;h</div>
        </div>
        <span className={`q-pill q-starts-pill ${st.tone}`}>{st.text.startsWith('Started') ? st.text : st.text.endsWith(' ago') ? `Started ${st.text}` : `Starts in ${st.text}`}</span>
        <Link href={closeHref} scroll={false} className="q-close" aria-label="Close">×</Link>
      </div>
      <div className="q-pills">
        {pill && <span className={`q-pill ${pill.cls}`}>{pill.label}</span>}
        {panel.offers.length > 0 && <span className="q-pill q-soft">Offered {panel.offers.length}{declined ? ` · ${declined} declined` : ''}{pending.length ? ` · ${pending.length} waiting` : ''}</span>}
        {s.genderRequested && <span className="q-pill q-soft">{GENDER[s.genderRequested]}</span>}
        {r?.presence.map(x => <span key={x.name} className="q-pill q-soft" title="Has it open now; it never blocks you">{x.name} is on it</span>)}
      </div>
      {s.pulledOutName && open && <p className="notice error" style={{ margin: 0 }}>{s.pulledOutName} pulled out. Fill it again below.</p>}
      {r?.orderNotes && <div className="q-note"><strong>{tw.one(T.client)} note:</strong> {r.orderNotes}</div>}
      {s.notes && <div className="q-note"><strong>{tw.one(T.shift)} note:</strong> {s.notes}</div>}

      {s.workerName ? (
        <div className="q-section">
          <div className="q-person">
            <span className="q-av big">{initials(s.workerName)}</span>
            <div style={{ minWidth: 0 }}>
              <strong>{s.workerName}</strong>{s.agencyName ? <span className="muted"> · {s.agencyName}</span> : null}
              <div className="muted small">{s.status === 'booked' ? 'Confirmed' : 'Waiting for them to confirm'}</div>
            </div>
          </div>
          {cc && <p className={cc.waiting ? 'notice small' : 'muted small'} style={{ margin: '6px 0 0' }}>{cc.text}</p>}
          <div className="q-actions">
            {s.status === 'assigned' && (
              <form action={confirm.bind(null, s.id)}>{back}<button className="btn small" title="They said yes">{s.agencyName ? 'Approve' : 'Confirm'}</button></form>
            )}
            {cc?.waiting && (
              <form action={clientConfirmed.bind(null, s.id)}>{back}<button className="btn small">{tw.one(T.client)} confirmed</button></form>
            )}
            {cc && !cc.waiting && (
              <form action={undoClientConfirmed.bind(null, s.id)}>{back}<button className="btn small secondary">Undo {client}&apos;s yes</button></form>
            )}
            <form action={unassign.bind(null, s.id)}>{back}<button className="btn small secondary">Remove</button></form>
            <form action={unassign.bind(null, s.id)}>{back}<input type="hidden" name="pulledOut" value="1" /><button className="btn small secondary" title={`They can't do it: the ${shift} needs someone again`}>They pulled out</button></form>
          </div>
        </div>
      ) : open ? (
        <>
          <div className="q-section">
            <div className="q-section-head"><h3>Best people for this {shift}</h3><span className="muted small">checked for {tw.lower(T.role)}, {tw.lower(T.credential, true)}, availability, hours</span></div>
            {best.length === 0 && <p className="muted small" style={{ margin: '4px 0' }}>Nobody else can work it right now{pending.length ? ' (the people offered it are below)' : ''}.</p>}
            {best.map((c, i) => (
              <div key={c.workerId} className="q-person">
                <span className="q-av">{initials(c.name)}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="q-name">{c.name}</div>
                  <div className={`small cut ${c.warnings.length ? 'warnline' : 'muted'}`} title={c.warnings.map(w => w.message).join('. ')}>{personLine(c)}</div>
                  <div className={`small cut ${c.siteHistory?.shiftsHere ? 'q-here' : 'muted'}`}>{hereLine(c.siteHistory, s.localDate, tw.lower(T.site))}</div>
                </div>
                <div className="q-person-btns">
                  <form action={offer.bind(null, s.id)}>{back}<input type="hidden" name="workerIds" value={c.workerId} /><button className="btn small secondary">Offer</button></form>
                  <form action={assign.bind(null, s.id, c.workerId)}>{back}<button className="btn small" data-key={i === 0 ? 'a' : undefined} title={i === 0 ? 'Shortcut: A' : undefined}>Assign</button></form>
                </div>
              </div>
            ))}
          </div>
          <div className="q-big-actions">
            <form action={offerFromQueue.bind(null, s.id, 'top')}>{back}
              <button className="btn secondary q-wide" data-key="o" disabled={best.length === 0}>Offer to the top {Math.min(5, best.length) || 5} <span className="muted">first to accept is booked</span></button>
            </form>
            <form action={offerFromQueue.bind(null, s.id, 'release')}>{back}
              <button className="btn secondary q-wide" data-key="r" disabled={canWork === 0}>Release to the {qw.bank} <span className="muted">{canWork} can work it</span></button>
            </form>
          </div>
          {pending.length > 0 && (
            <div className="q-section">
              <h3>Waiting for a reply</h3>
              {pending.map(o => (
                <div key={o.id} className="panel-row small">
                  <span>{o.workerName ?? o.name}</span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <form action={recordReply.bind(null, o.id, 'accept')}>{back}<button className="btn small secondary" title="They told you yes">They said yes</button></form>
                    <form action={recordReply.bind(null, o.id, 'decline')}>{back}<button className="btn small secondary">No</button></form>
                  </span>
                </div>
              ))}
            </div>
          )}
          {panel.agency && (panel.agency.activeAgencies > 0 || panel.agency.request) && <AgencyFillSection st={panel.agency} shiftId={s.id} here={here} when={when} tw={tw} />}
        </>
      ) : <p className="muted">This {shift} is {s.status}.</p>}
      <div className="q-panel-foot">
        <Link href={findStaffHref(s)}>Open in the {tw.lower(T.roster)}</Link>
        <span className="muted small">for duties, times, history and everything else</span>
      </div>
    </aside>
  );
}
