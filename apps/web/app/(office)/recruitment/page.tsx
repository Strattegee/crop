import Link from 'next/link';
import { api } from '../../../lib/api';
import { businessSettings, businessZone, todayIn } from '../../../lib/business';
import { mobileExample } from '../../../lib/phone';
import { industryGroups, type PackInfo } from '../../../lib/industry-groups';
import type { CardPerson } from '../../../lib/person-card';
import { T, words } from '../../../lib/terms';
import { Notices } from '../notices';
import { PersonCard } from '../workers/person-card';
import { RolePicker } from '../workers/role-picker';
import { checklistOption, suggestedChecklist, type ChecklistChoice } from '../../../lib/onboarding';
import { addApplicant, moveTo, startOnboarding } from './actions';
import { BoardDrag } from './board-drag';
import { STAGES, nextStage, previousStage, daysLine } from '../../../lib/recruitment';
import { listQuery, parseRecruitParams } from '../../../lib/recruitment-list';
import { RecruitList, type ListData } from './list-view';

export const dynamic = 'force-dynamic';

type BoardPerson = CardPerson & {
  stage: string | null; days: number | null; mustHavesToDo: number; appliedOnline?: boolean;
  onboardingId?: string; progress?: { done: number; total: number; ready: boolean };
};
type Board = { columns: { stage: string; label: string; people: BoardPerson[] }[]; notProceeding: number };

/**
 * The recruitment board (David, 31 Oct): one record from applicant to worker, each person shown as their employee
 * card. Applied → Screening → Interview → Offer, then Onboarding (off the roster until finished), then Started.
 */
export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tw = await words();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const asBoard = one('show') === 'board';
  const lp = parseRecruitParams(sp);
  const [b, list, sites, checklists, packs, roleList] = await Promise.all([
    asBoard ? api<Board>('/recruitment') : Promise.resolve(null),
    asBoard ? Promise.resolve(null) : api<ListData>(`/recruitment/list${listQuery(lp)}`),
    asBoard ? Promise.resolve([]) : api<{ id: string; name: string; active: boolean }[]>('/facilities').catch(() => []),
    api<ChecklistChoice[]>('/onboarding-checklists').catch(() => [] as ChecklistChoice[]),
    api<PackInfo[]>('/industry-packs').catch(() => [] as PackInfo[]),
    api<{ id: string; name: string; active: boolean; industries?: string[] }[]>('/roles').catch(() => []),
  ]);
  const zone = await businessZone();
  const today = todayIn(zone);
  const country = (await businessSettings()).country;
  const roleGroups = industryGroups(roleList.filter(r => r.active), packs);
  const total = b ? b.columns.reduce((n, c) => n + c.people.length, 0) : Object.values(list!.counts).reduce((n, c) => n + c, 0);
  const switchTo = (
    <span className="view-switch" style={{ marginLeft: 'auto' }}>
      <Link href="/recruitment" aria-current={!asBoard ? 'true' : undefined}>List</Link>
      <Link href="/recruitment?show=board" aria-current={asBoard ? 'true' : undefined}>Board</Link>
    </span>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><h1>Recruitment</h1>{switchTo}</div>
      <p className="muted">Everyone from the day they apply to their first weeks at work, each shown on their employee card. Applicants and people being onboarded are kept off the {tw.lower(T.roster)} until they start. People can also apply through your <Link href="/settings/application-form">application form</Link>.</p>
      <Notices error={one('error')} done={one('done')} />

      <details className="card" open={total === 0}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add an applicant</summary>
        <form action={addApplicant} className="form-row" style={{ marginTop: 12 }}>
          <input type="hidden" name="back" value={asBoard ? '/recruitment?show=board' : '/recruitment'} />
          <label>First name<input name="firstName" required maxLength={100} /></label>
          <label>Last name<input name="lastName" required maxLength={100} /></label>
          <label>Email<input name="email" type="email" maxLength={200} /></label>
          <label>Mobile<input name="phone" maxLength={30} inputMode="tel" placeholder={mobileExample(country)} /></label>
          <RolePicker groups={roleGroups} label={`${tw.many(T.role)} applied for`} />
          <button className="btn">Add to Applied</button>
        </form>
      </details>

      {list && (
        <RecruitList data={list} p={lp} tw={tw} zone={zone} roleGroups={roleGroups} canOnboard={checklists.length > 0}
          sites={sites.filter(s => s.active !== false).map(s => ({ id: s.id, name: s.name }))} />
      )}
      {b && <>
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
                    {p.appliedOnline && col.stage === 'applied' && <span className="badge neutral" title="They applied through your online form">Applied online</span>}
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
                          <select name="checklistId" required defaultValue={(suggestedChecklist(checklists, p.roles) ?? checklists[0]).id} aria-label="Onboarding checklist">
                            {checklists.map(c => <option key={c.id} value={c.id}>{checklistOption(c)}</option>)}
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
      </>}
    </>
  );
}
