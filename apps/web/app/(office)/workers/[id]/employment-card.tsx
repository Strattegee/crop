import { addEmploymentTerms, correctEmploymentTerms, withdrawEmploymentTerms } from './employment-actions';

export type EmploymentTerms = {
  id: string; employmentType: string; contractedHours: number | null; startsOn: string; endsOn: string | null;
  withdrawnAt?: string | null; withdrawnReason?: 'corrected' | 'withdrawn' | null;
};

export const EMPLOYMENT_LABEL: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual', bank: 'Bank (relief pool)' };
const d = (s: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));
const hrs = (h: number | null) => (h === null ? 'no set hours' : `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')} hours a week`);

/**
 * Employment on a person's page: full-time, part-time, casual or bank, and contracted hours a week.
 * Effective-dated: new terms start on a date and the previous ones end the day before, so past rosters keep
 * the terms that applied then. The roster compares rostered hours with the contracted hours.
 */
export function EmploymentCard({ workerId, terms: all, today, canEdit }: { workerId: string; terms: EmploymentTerms[]; today: string; canEdit: boolean }) {
  const terms = all.filter(t => !t.withdrawnAt);
  const fixedUp = all.filter(t => t.withdrawnAt);
  const latest = terms.reduce<EmploymentTerms | null>((m, t) => (m === null || t.startsOn > m.startsOn ? t : m), null);
  const previous = latest ? terms.filter(t => t.startsOn < latest.startsOn).reduce<EmploymentTerms | null>((m, t) => (m === null || t.startsOn > m.startsOn ? t : m), null) : null;
  const current = terms.find(t => t.startsOn <= today && (t.endsOn === null || t.endsOn >= today)) ?? null;
  const upcoming = terms.filter(t => t.startsOn > today).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const latestStart = terms.reduce<string | null>((m, t) => (m === null || t.startsOn > m ? t.startsOn : m), null);
  return (
    <div className="card">
      <h2>Employment</h2>
      {current ? (
        <p style={{ marginTop: 0 }}>
          <strong>{EMPLOYMENT_LABEL[current.employmentType] ?? current.employmentType}</strong>, {hrs(current.contractedHours)}
          <span className="muted"> · since {d(current.startsOn)}{current.endsOn ? `, until ${d(current.endsOn)}` : ''}</span>
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>No employment recorded for today. The roster shows their hours without a contract to compare with.</p>
      )}
      {upcoming.map(t => (
        <p key={t.id} style={{ margin: '0 0 8px' }}>
          From {d(t.startsOn)}: <strong>{EMPLOYMENT_LABEL[t.employmentType] ?? t.employmentType}</strong>, {hrs(t.contractedHours)}
        </p>
      ))}
      {canEdit && terms.length > 0 && (
        <details style={{ marginBottom: 8 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>Correct a mistake</summary>
          <p className="muted small">Fix the type or hours of any entry. The latest entry can also start on a different date, or be withdrawn if it was added by mistake. The old entry is kept, marked corrected.</p>
          {[...terms].sort((a, b) => b.startsOn.localeCompare(a.startsOn)).map(t => (
            <div key={t.id} style={{ borderTop: '1px solid var(--line, #ddd)', paddingTop: 8, marginTop: 8 }}>
              <form action={correctEmploymentTerms.bind(null, workerId, t.id)} className="form-row">
                {t.id === latest?.id ? (
                  <label>From
                    <input type="date" name="startsOn" required defaultValue={t.startsOn} min={previous ? nextDay(previous.startsOn) : undefined} />
                  </label>
                ) : (
                  <span className="muted small" style={{ alignSelf: 'center' }}>{d(t.startsOn)} to {t.endsOn ? d(t.endsOn) : 'now'}</span>
                )}
                <label>Type
                  <select name="employmentType" defaultValue={t.employmentType}>
                    {Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>Hours a week
                  <input type="number" name="contractedHours" min={0} max={80} step={0.25} defaultValue={t.contractedHours ?? undefined} placeholder="Blank for none" />
                </label>
                <button className="btn small secondary">Correct</button>
              </form>
              {t.id === latest?.id && (
                <form action={withdrawEmploymentTerms.bind(null, workerId, t.id)} style={{ marginTop: 4 }}>
                  <button className="btn small secondary">Withdraw this entry</button>
                  <span className="muted small"> {previous ? `${EMPLOYMENT_LABEL[previous.employmentType] ?? previous.employmentType} from ${d(previous.startsOn)} carries on.` : 'They will have no employment recorded.'}</span>
                </form>
              )}
            </div>
          ))}
        </details>
      )}
      {(terms.length > 1 || fixedUp.length > 0) && (
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>History ({terms.length}{fixedUp.length ? `, ${fixedUp.length} corrected` : ''})</summary>
          <table className="compact" style={{ marginTop: 8 }}>
            <thead><tr><th>From</th><th>Until</th><th>Type</th><th>Hours a week</th></tr></thead>
            <tbody>
              {terms.map(t => (
                <tr key={t.id}>
                  <td>{d(t.startsOn)}</td><td>{t.endsOn ? d(t.endsOn) : '—'}</td>
                  <td>{EMPLOYMENT_LABEL[t.employmentType] ?? t.employmentType}</td><td>{t.contractedHours ?? '—'}</td>
                </tr>
              ))}
              {fixedUp.map(t => (
                <tr key={t.id} className="muted">
                  <td><s>{d(t.startsOn)}</s></td><td><s>{t.endsOn ? d(t.endsOn) : '—'}</s></td>
                  <td><s>{EMPLOYMENT_LABEL[t.employmentType] ?? t.employmentType}</s></td>
                  <td><s>{t.contractedHours ?? '—'}</s> {t.withdrawnReason === 'withdrawn' ? 'withdrawn' : 'corrected'} {t.withdrawnAt ? d(t.withdrawnAt.slice(0, 10)) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {canEdit ? (
        <form action={addEmploymentTerms.bind(null, workerId)} className="form-row" style={{ marginTop: 12 }}>
          <label>{current || terms.length ? 'New terms from' : 'Starting'}
            <input type="date" name="startsOn" required defaultValue={latestStart && latestStart >= today ? nextDay(latestStart) : today} min={latestStart ? nextDay(latestStart) : undefined} />
          </label>
          <label>Type
            <select name="employmentType" defaultValue={current?.employmentType ?? 'casual'}>
              {Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Hours a week
            <input type="number" name="contractedHours" min={0} max={80} step={0.25} defaultValue={current?.contractedHours ?? undefined} placeholder="Leave blank for casual or bank" />
          </label>
          <button className="btn small">Save</button>
        </form>
      ) : (
        <p className="muted small" style={{ marginBottom: 0 }}>Owners and admins change employment.</p>
      )}
      {canEdit && latestStart && <p className="muted small" style={{ marginBottom: 0 }}>Changes start on a date; earlier rosters keep the terms that applied then. New terms must start after {d(latestStart)}.</p>}
    </div>
  );
}

function nextDay(s: string) {
  return new Date(Date.parse(`${s}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
