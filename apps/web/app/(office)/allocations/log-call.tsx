import { CALL_OUTCOMES, OUTCOME_LABEL } from '../../../lib/calls';
import { logCall } from './actions';

/**
 * "Log a call" (David, 3 Nov 2026): open it, optionally type a short note, press the outcome. Two clicks; CROP
 * doesn't dial. `data-hold` keeps the queue's refresh from closing it.
 */
export function LogCall({ back, who, workerId, clientId, contactId, contactName, shiftId, label = 'Log a call' }: {
  back: string; who: string; workerId?: string | null; clientId?: string | null; contactId?: string | null; contactName?: string | null;
  shiftId?: string | null; label?: string;
}) {
  const hidden = { back, who, workerId, clientId, contactId, contactName, shiftId };
  return (
    <details className="log-call" data-hold>
      <summary title={`Record a call with ${who}`}>{label}</summary>
      <form action={logCall} className="log-call-pop" aria-label={`Call with ${who}`}>
        {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <p className="small" style={{ margin: '0 0 6px' }}>Call with <strong>{who}</strong></p>
        <input name="note" maxLength={300} placeholder="Note (optional, no health details)" aria-label="Note" />
        <label className="inline small"><input type="checkbox" name="direction" value="in" /> They rang us</label>
        <div className="log-call-btns">
          {CALL_OUTCOMES.map(o => <button key={o} name="outcome" value={o} className="btn small secondary">{OUTCOME_LABEL[o]}</button>)}
        </div>
      </form>
    </details>
  );
}
