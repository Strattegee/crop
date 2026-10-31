import Link from 'next/link';
import { api } from '../../../lib/api';
import { businessZone, todayIn } from '../../../lib/business';
import { industryGroups, type PackInfo } from '../../../lib/industry-groups';
import type { CardPerson } from '../../../lib/person-card';
import { T, words } from '../../../lib/terms';
import { Notices } from '../notices';
import { PersonCard } from '../workers/person-card';
import { RolePicker } from '../workers/role-picker';
import { addApplicant, moveTo, startOnboarding } from './actions';
import { BoardDrag } from './board-drag';
import { STAGES, nextStage, previousStage, daysLine } from '../../../lib/recruitment';

export const dynamic = 'force-dynamic';

type BoardPerson = CardPerson & {
  stage: string | null; days: number | null; mustHavesToDo: number;
  onboardingId?: string; progress?: { done: number; total: number; ready: boolean };
};
type Board = { columns: { stage: string; label: string; people: BoardPerson[] }[]; notProceeding: number };

/**
 * The recruitment board (David, 31 Oct): one record from applicant to worker, each person shown as their employee
 * card. Applied → Screening → Interview → Offer, then Onboarding (off the roster until finished), then Started.
 */
export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const tw = await words();
  const sp = await searchParams;
  const [b, checklists, packs, roleList] = await Promise.all([
    api<Board>('/recruitment'),
    api<{ id: string; name: string }[]>('/onboarding-checklists').catch(() => [] as { id: string; name: string }[]),
    api<PackInfo[]>('/industry-packs').catch(() => [] as PackInfo[]),
    api<{ id: string; name: string; active: boolean; industries?: string[] }[]>('/roles').catch(() => []),
  ]);
  const today = todayIn(await businessZone());
  const roleGroups = industryGroups(roleList.filter(r => r.active), packs);
  const total = b.columns.reduce((n, c) => n + c.people.length, 0);

  return (
    <>
      <h1>Recruitment</h1>
      <p className="muted">Everyone from application to their first weeks, each as their card. Applicants and people being onboarded are kept off the {tw.lower(T.roster)} until they start.</p>
      <Notices error={sp.error} done={sp.done} />

      <details className="card" open={total === 0}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add an applicant</summary>
        <form action={addApplicant} className="form-row" style={{ marginTop: 12 }}>
          <label>First name<input name="firstName" required maxLength={100} /></label>
          <label>Last name<input name="lastName" required maxLength={100} /></label>
          <label>Email<input name="email" type="email" maxLength={200} /></label>
          <label>Mobile<input name="phone" maxLength={30} /></label>
          <RolePicker groups={roleGroups} label={`${tw.many(T.role)} applied for`} />
          <button className="btn">Add to Applied</button>
        </form>
      </details>

      {total > 0 && <p className="muted small" style={{ margin: '0 0 8px' }}>Drag a card to another stage, or use its buttons.</p>}
      <BoardDrag>
        {b.columns.map(col => (
          <section key={col.stage} className={`rcol rcol-${col.stage}`} data-stage={col.stage}>
            <h2>{col.label} <span className="muted">{col.people.length}</span></h2>
            {col.people.length === 0 && <p className="muted small rcol-empty">Nobody here</p>}
            {col.people.map(p => {
              const next = nextStage(col.stage);
              const prev = previousStage(col.stage);
              return (
                <div key={p.id} className="rperson">
                  {/* Only the card and its line are draggable, so the reason box below still takes text normally. */}
                  <div className="rdrag" data-id={p.id} data-stage={col.stage} draggable={STAGES.includes(col.stage) ? true : undefined}>
                  <PersonCard p={p} today={today} />
                  <div className="rmeta">
                    <span>{daysLine(col.stage, p.days)}</span>
                    {col.stage === 'onboarding' && p.progress && (
                      <span className={p.progress.ready ? 'ok' : ''}>{p.progress.done} of {p.progress.total} steps done{p.progress.ready ? ' · ready to finish' : ''}</span>
                    )}
                    {col.stage !== 'started' && col.stage !== 'onboarding' && p.mustHavesToDo > 0 && <span className="warn">{p.mustHavesToDo} must-have{p.mustHavesToDo === 1 ? '' : 's'} to collect</span>}
                  </div>
                  </div>
                  {STAGES.includes(col.stage) && (
                    <div className="ractions">
                      {next && (
                        <form action={moveTo.bind(null, p.id, next.stage, `Moved to ${next.label}.`)}>
                          <button className="btn small">{next.label} →</button>
                        </form>
                      )}
                      {col.stage === 'offer' && (checklists.length ? (
                        <form action={startOnboarding.bind(null, p.id)} className="rinline">
                          <select name="checklistId" required defaultValue={checklists[0].id} aria-label="Onboarding checklist">
                            {checklists.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <button className="btn small">Start onboarding →</button>
                        </form>
                      ) : <Link className="small" href="/settings/onboarding">Set up an onboarding checklist</Link>)}
                      <details className="rmore">
                        <summary>More</summary>
                        {prev && (
                          <form action={moveTo.bind(null, p.id, prev.stage, `Moved back to ${prev.label}.`)}>
                            <button className="btn small secondary">← Back to {prev.label}</button>
                          </form>
                        )}
                        <form action={moveTo.bind(null, p.id, 'not_proceeding', 'Marked as not proceeding.')} className="rinline">
                          <input name="note" placeholder="Reason (optional)" maxLength={500} />
                          <button className="btn small secondary">Not proceeding</button>
                        </form>
                      </details>
                    </div>
                  )}
                  {col.stage === 'onboarding' && (
                    <div className="ractions"><Link className="btn small secondary" href={`/workers/${p.id}`}>Open onboarding</Link></div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </BoardDrag>
      {b.notProceeding > 0 && (
        <p className="muted small">{b.notProceeding} not proceeding in the last 30 days. <Link href="/recruitment/not-proceeding">See them</Link></p>
      )}
    </>
  );
}
