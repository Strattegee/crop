import { addEmploymentTerms } from './employment-actions';

export type EmploymentTerms = { id: string; employmentType: string; contractedHours: number | null; startsOn: string; endsOn: string | null };

export const EMPLOYMENT_LABEL: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual', bank: 'Bank (relief pool)' };
const d = (s: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));
const hrs = (h: number | null) => (h === null ? 'no set hours' : `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')} hours a week`);

/**
 * Employment on a person's page: full-time, part-time, casual or bank, and contracted hours a week.
 * Effective-dated: new terms start on a date and the previous ones end the day before, so past rosters keep
 * the terms that applied then. The roster compares rostered hours with the contracted hours.
 */
export function EmploymentCard({ workerId, terms, today, canEdit }: { workerId: string; terms: EmploymentTerms[]; today: string; canEdit: boolean }) {
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
      {terms.length > 1 && (
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>History ({terms.length})</summary>
          <table className="compact" style={{ marginTop: 8 }}>
            <thead><tr><th>From</th><th>Until</th><th>Type</th><th>Hours a week</th></tr></thead>
            <tbody>
              {terms.map(t => (
                <tr key={t.id}>
                  <td>{d(t.startsOn)}</td><td>{t.endsOn ? d(t.endsOn) : '—'}</td>
                  <td>{EMPLOYMENT_LABEL[t.employmentType] ?? t.employmentType}</td><td>{t.contractedHours ?? '—'}</td>
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
