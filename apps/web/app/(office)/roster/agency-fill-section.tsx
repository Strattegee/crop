import { T, type Words } from '../../../lib/terms';
import { minutesWords, requestStepChoices } from '../../../lib/agency-timing';
import { agencyFill, agencyFillNext, agencyFillWithdraw } from './actions';

/** `GET /shifts/:id/agency-fill` (migration 0040). */
export type AgencyFillState = {
  request: { id: string; status: 'open' | 'filled' | 'withdrawn' | 'expired'; note: string | null; stepMinutes: number | null; createdByName: string | null; createdAt: string; closedReason: string | null } | null;
  rounds: { id: string; agencyName: string; position: number; dueAt: string; sentAt: string | null; state: 'sent' | 'waiting' | 'skipped'; skippedReason: string | null; dueIn: string | null }[];
  next: { agencyName: string; dueIn: string } | null;
  activeAgencies: number; canRequest: boolean; problem: string | null;
  timing?: { band: 'soon' | 'today' | 'later'; bandWords: string; defaultMinutes: number; defaultWords: string };
  placement: { agencyName: string; workerName: string; status: 'waiting' | 'booked' | 'declined' | 'removed' | 'pulled_out' | 'cancelled'; state: string; putForwardByName: string | null; createdAt: string; confirmedCredentials?: string[] } | null;
};
/**
 * The shift panel's {agency} fill part (roster and Allocations): send an open shift to the business's linked agencies,
 * first in order now and the rest on the timer; who has it, send to the next now, take it back. `here` is where the
 * forms return to (a /roster or /allocations URL).
 */
export function AgencyFillSection({ st, shiftId, here, when, tw }: { st: AgencyFillState; shiftId: string; here: string; when: (iso: string) => string; tw: Words }) {
  const agencies = tw.lower(T.agency, true);
  const open = st.request?.status === 'open' ? st.request : null;
  const closed = st.request && !open ? st.request : null;
  return (
    <div className="agencyfill" style={{ marginTop: 12 }}>
      <p style={{ margin: '0 0 6px' }}><strong>{tw.one(T.agency)} fill</strong> <span className="muted">· send it to your {agencies} when your own staff can&apos;t cover it</span></p>
      {open && (
        <>
          <p className="small" style={{ margin: '0 0 4px' }}>
            With {agencies} since {when(open.createdAt)}{open.createdByName ? ` (${open.createdByName})` : ''}.
            {open.stepMinutes && st.rounds.length > 1 ? ` ${minutesWords(open.stepMinutes)} between each.` : ''}{open.note ? ` Note: ${open.note}` : ''}
          </p>
          {st.rounds.map(r => (
            <div key={r.id} className="panel-row small">
              <span>{r.position}. {r.agencyName}</span>
              <span className="muted">{r.state === 'sent' ? `has it since ${when(r.sentAt!)}` : r.state === 'waiting' ? `gets it ${r.dueIn}` : r.skippedReason ?? 'skipped'}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {st.next && (
              <form action={agencyFillNext.bind(null, shiftId)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Send to {st.next.agencyName} now</button></form>
            )}
            <form action={agencyFillWithdraw.bind(null, shiftId)}><input type="hidden" name="back" value={here} /><button className="btn small secondary">Take it back</button></form>
          </div>
          <p className="muted small" style={{ margin: '6px 0 0' }}>Putting someone on it yourself takes it back from the {agencies} too.</p>
        </>
      )}
      {!open && closed && (
        <p className="muted small" style={{ margin: '0 0 6px' }}>
          Last sent {when(closed.createdAt)}: {st.placement ? `${st.placement.agencyName} put forward ${st.placement.workerName} (${st.placement.state.toLowerCase()})` : closed.closedReason ?? closed.status}.
        </p>
      )}
      {!open && st.canRequest && (
        <form action={agencyFill.bind(null, shiftId)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="hidden" name="back" value={here} />
          <label className="sr-only" htmlFor="agencyNote">Note for the {agencies}</label>
          <input id="agencyNote" name="note" maxLength={300} placeholder={`Note for the ${agencies} (optional)`} style={{ flex: '1 1 180px' }} />
          {st.timing && st.activeAgencies > 1 && (
            <label className="small">Next {tw.lower(T.agency)} after{' '}
              <select name="stepMinutes" defaultValue="" title={`Your usual for a ${tw.lower(T.shift)} that ${st.timing.bandWords} (Settings → ${tw.many(T.agency)})`}>
                {requestStepChoices(st.timing.defaultMinutes).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          )}
          <button className="btn small">Send to {agencies}</button>
        </form>
      )}
      {!open && !st.canRequest && st.problem && <p className="muted small" style={{ margin: 0 }}>{st.problem}</p>}
    </div>
  );
}
