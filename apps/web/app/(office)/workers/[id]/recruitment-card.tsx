import Link from 'next/link';
import { historyLine, nextStage, previousStage, recruitmentState, type RecruitmentEvent } from '../../../../lib/recruitment';
import { checklistOption, suggestedChecklist, type ChecklistChoice } from '../../../../lib/onboarding';
import { moveFrom, startOnboardingFrom } from '../../recruitment/actions';

/**
 * Recruitment on the person's page (David, 31 Oct): where they are, the same moves as the board for applicants, and
 * every move so far (who, when, any note). Shown only for people who have been through recruitment.
 */
export function RecruitmentCard({ workerId, status, stage, events, checklists, roles = [], when }: {
  workerId: string; status: string; stage: string | null; events: RecruitmentEvent[];
  checklists: ChecklistChoice[]; roles?: string[]; when: (iso: string) => string;
}) {
  const state = recruitmentState(status, stage, events);
  if (!state) return null;
  const back = `/workers/${workerId}`;
  const at = status === 'applicant' ? stage ?? 'applied' : null;
  const next = at ? nextStage(at) : null;
  const prev = at ? previousStage(at) : null;
  const shown = [...events].reverse();
  return (
    <div className="card">
      <h2>Recruitment <span className="muted small">· {state}</span></h2>
      {at && (
        <div className="rinline" style={{ marginBottom: 12 }}>
          {next && (
            <form action={moveFrom.bind(null, back, workerId, next.stage, `Moved to ${next.label}.`)}>
              <button className="btn small">{next.label} →</button>
            </form>
          )}
          {at === 'offer' && (checklists.length ? (
            <form action={startOnboardingFrom.bind(null, back, workerId)} className="rinline">
              <select name="checklistId" required defaultValue={(suggestedChecklist(checklists, roles) ?? checklists[0]).id} aria-label="Onboarding checklist">
                {checklists.map(c => <option key={c.id} value={c.id}>{checklistOption(c)}</option>)}
              </select>
              <button className="btn small">Start onboarding →</button>
            </form>
          ) : <Link className="small" href="/settings/onboarding">Set up an onboarding checklist</Link>)}
          {prev && (
            <form action={moveFrom.bind(null, back, workerId, prev.stage, `Moved back to ${prev.label}.`)}>
              <button className="btn small secondary">← Back to {prev.label}</button>
            </form>
          )}
          <form action={moveFrom.bind(null, back, workerId, 'not_proceeding', 'Marked as not proceeding.')} className="rinline">
            <input name="note" placeholder="Reason (optional)" maxLength={500} aria-label="Reason for not proceeding" />
            <button className="btn small secondary">Not proceeding</button>
          </form>
          <Link className="small" href="/recruitment">Recruitment board</Link>
        </div>
      )}
      {state === 'Not proceeding' && (
        <form action={moveFrom.bind(null, back, workerId, 'reopen', 'Reopened.')} style={{ marginBottom: 12 }}>
          <button className="btn small secondary">Reopen</button>
        </form>
      )}
      {shown.length === 0 ? <p className="muted" style={{ margin: 0 }}>No moves recorded yet.</p> : (
        <ol className="rhist" aria-label="Recruitment history, newest first">
          {shown.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <time dateTime={e.at}>{when(e.at)}</time>
              <span>
                {historyLine(e)}
                {e.byName && <span className="muted"> · by {e.byName}</span>}
                {e.note && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{e.note}</div>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
