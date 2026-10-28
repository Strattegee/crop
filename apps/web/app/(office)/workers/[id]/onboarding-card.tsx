import Link from 'next/link';
import { finishOnboarding, startOnboarding, stopOnboarding, tickStep } from './onboarding-actions';

type StepState = 'done' | 'waiting' | 'to_do';
export type Onboarding = {
  current: null | {
    id: string; checklistName: string; startedAt: string; startedByName: string | null;
    steps: { id: string; title: string; help: string | null; kind: string; required: boolean; state: StepState; detail: string; note: string | null }[];
    summary: { done: number; total: number; ready: boolean; outstanding: string[] };
  };
  history: { id: string; checklistName: string; finishedAt: string; finishedByName: string | null; outcome: 'completed' | 'stopped'; stopReason: string | null }[];
};
type Checklist = { id: string; name: string; archived: boolean; steps: unknown[] };

const MARK: Record<StepState, string> = { done: '✓', waiting: '…', to_do: '○' };
const COLOUR: Record<StepState, string> = { done: 'var(--ok, #1a7f37)', waiting: 'var(--warn, #9a6700)', to_do: 'var(--muted, #6e7781)' };


/**
 * The person's onboarding: each step with its state (record steps tick themselves), tick boxes for tasks, and
 * Finish (owners and admins, once every required step is done) or Stop.
 */
export function OnboardingCard({ workerId, o, checklists, status, canDecide, timeZone }: {
  workerId: string; o: Onboarding; checklists: Checklist[]; status: string; canDecide: boolean; timeZone: string;
}) {
  // Dates in the business's time zone, never the server's.
  const day = (s: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(s));
  const c = o.current;
  const usable = checklists.filter(x => !x.archived);
  if (!c && !o.history.length && status !== 'onboarding' && !usable.length) return null;
  return (
    <div className="card">
      <h2>Onboarding</h2>
      {c ? (
        <>
          <p style={{ marginTop: 0 }}>
            <b>{c.checklistName}</b> · {c.summary.done} of {c.summary.total} required steps done
            <span className="muted small"> · started {day(c.startedAt)}{c.startedByName && ` by ${c.startedByName}`}</span>
          </p>
          <div aria-hidden style={{ height: 6, background: 'var(--line, #d0d7de)', borderRadius: 3, marginBottom: 10 }}>
            <div style={{ height: 6, width: `${c.summary.total ? Math.round((c.summary.done / c.summary.total) * 100) : 100}%`, background: COLOUR.done, borderRadius: 3 }} />
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {c.steps.map(s => (
              <li key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
                {s.kind === 'task' ? (
                  <form action={tickStep.bind(null, workerId, c.id, s.id, s.state !== 'done')}>
                    <button type="submit" className="btn small secondary" style={{ minWidth: 34, minHeight: 26 }} aria-label={s.state === 'done' ? `Untick ${s.title}` : `Tick ${s.title}`}>
                      {s.state === 'done' ? '✓' : '\u00a0'}
                    </button>
                  </form>
                ) : (
                  <span style={{ minWidth: 34, textAlign: 'center', color: COLOUR[s.state], fontWeight: 700 }} aria-hidden>{MARK[s.state]}</span>
                )}
                <div>
                  <span>{s.title}</span>
                  {!s.required && <span className="muted small"> · optional</span>}
                  <div className="small" style={{ color: COLOUR[s.state] }}>{s.detail}</div>
                  {s.help && <div className="muted small">{s.help}</div>}
                </div>
              </li>
            ))}
          </ul>
          {canDecide ? (
            <div className="form-row" style={{ marginTop: 12 }}>
              <form action={finishOnboarding.bind(null, workerId, c.id)}>
                <button type="submit" className="btn" disabled={!c.summary.ready} style={c.summary.ready ? undefined : { opacity: 0.5, cursor: 'not-allowed' }} title={c.summary.ready ? undefined : `Still to do: ${c.summary.outstanding.join(', ')}`}>
                  Finish onboarding{status !== 'active' ? ' and make active' : ''}
                </button>
              </form>
              <details>
                <summary style={{ cursor: 'pointer' }}>Stop onboarding</summary>
                <form action={stopOnboarding.bind(null, workerId, c.id)} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input name="reason" required maxLength={300} placeholder="Why, e.g. took another job" />
                  <button type="submit" className="btn small secondary">Stop</button>
                </form>
              </details>
            </div>
          ) : (
            <p className="muted small">An owner or admin finishes onboarding once every required step is done.</p>
          )}
        </>
      ) : usable.length ? (
        <form action={startOnboarding.bind(null, workerId)} className="form-row" style={{ marginTop: 0 }}>
          <label>Checklist
            <select name="checklistId" required>{usable.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          {status === 'active' && <label className="inline"><input type="checkbox" name="hold" defaultChecked={false} /> Keep them off the roster until it’s finished</label>}
          {status === 'onboarding' && <input type="hidden" name="hold" value="on" />}
          <button type="submit" className="btn small">Start onboarding</button>
        </form>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>No onboarding checklists yet. <Link href="/settings/onboarding">Add one in Settings</Link>.</p>
      )}
      {o.history.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer' }}>Earlier onboarding</summary>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {o.history.map(h => (
              <li key={h.id}>{h.checklistName}: {h.outcome === 'completed' ? 'finished' : `stopped (${h.stopReason})`} {day(h.finishedAt)}{h.finishedByName && ` by ${h.finishedByName}`}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
