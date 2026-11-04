import Link from 'next/link';
import { changeLine, nowLine, STATUS_WORD, type DetailChange } from '../../../../lib/detail-changes';
import { approveDetailChange, declineDetailChange } from './detail-change-actions';

/**
 * Changes people asked for in the app to their own details, waiting for an owner or admin (the business's
 * Personal details settings say which need approval). On the Dashboard (everyone's, with names) and on a person's
 * Details tab (theirs, with the ones lately decided).
 */
export function DetailChangesCard({ changes, back, country, withNames }: { changes: DetailChange[]; back: string; country?: string | null; withNames: boolean }) {
  if (changes.length === 0) return null;
  const waiting = changes.filter(c => c.status === 'pending');
  return (
    <section className="card dash-details" style={{ marginTop: 16 }}>
      <h2>{withNames ? 'Detail changes to approve' : 'Changes asked for in the app'}</h2>
      <ol className="dash-list">
        {changes.map(c => (
          <li key={c.id} data-detail-change={c.id}>
            <div>
              {withNames && <><Link href={`/workers/${c.workerId}?tab=details`}>{c.workerName}</Link>: </>}
              <strong>{c.label}</strong> <span className="muted">· {changeLine(c, country)}</span>
              {!withNames && c.status !== 'pending' && <span className="muted small"> · {STATUS_WORD[c.status]}{c.decidedByName ? ` by ${c.decidedByName}` : ''}</span>}
            </div>
            {c.status === 'pending' && nowLine(c, country) && <div className="muted small">{nowLine(c, country)}</div>}
            {c.status === 'pending' && (c.canDecide ? (
              <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <form action={approveDetailChange}>
                  <input type="hidden" name="id" value={c.id} /><input type="hidden" name="back" value={back} />
                  <button type="submit" className="btn">Approve</button>
                </form>
                <details>
                  <summary className="btn secondary">Don&apos;t approve</summary>
                  <form action={declineDetailChange} style={{ marginTop: 6 }}>
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="back" value={back} />
                    <label>Note for them <span className="muted">(optional; no health details)</span><input name="note" maxLength={300} /></label>
                    <button type="submit" className="btn secondary">Don&apos;t approve the change</button>
                  </form>
                </details>
              </div>
            ) : <div className="muted small">An owner or admin approves changes.</div>)}
          </li>
        ))}
      </ol>
      {waiting.length > 0 && <p className="muted small">Approving makes the change and tells them in the app (or by email). Earlier values are kept in the audit log; earlier addresses stay on file.</p>}
    </section>
  );
}
