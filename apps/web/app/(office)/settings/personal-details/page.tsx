import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { ACCESS_ORDER, FIXED_DETAILS, accessChoices, accessSummary, type Access, type FieldAccessRow } from '../../../../lib/field-access';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { saveFieldAccess } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Settings › Personal details (function 9180, David, 3 Nov 2026, answer 5): who can see and change each piece of a
 * person's details. The office always sees and changes everything; each field says what the person themselves gets
 * in the app. Owners and administrators change it; other office people can read it.
 */
export default async function PersonalDetailsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [tw, agency, data, sp] = await Promise.all([
    words(), currentAgency(), api<{ fields: FieldAccessRow[]; words: Record<Access, string> }>('/field-access'), searchParams,
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const worker = tw.lower(T.worker);

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>Personal details</h1>
      <p className="muted">
        Who can see and change each piece of a {worker}’s details. Your office always can; here you choose what the {worker} gets in the
        CROP app: nothing, a look, a change you approve, or a change of their own. Nothing is overwritten: earlier values stay in the audit log,
        and earlier addresses stay on their record.
      </p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can change these.</div>}

      <form action={saveFieldAccess} className="card">
        <p className="muted small" style={{ marginTop: 0 }}>{accessSummary(data.fields)}</p>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Detail</th><th>What the {worker} gets in the app</th></tr></thead>
            <tbody>
              {data.fields.map(r => (
                <tr key={r.field}>
                  <td><strong>{r.label}</strong>{r.note && <div className="muted small">{r.note}</div>}</td>
                  <td>
                    {canEdit ? (
                      <select name={r.field} defaultValue={r.person} aria-label={`${r.label}: what the ${worker} gets`}>
                        {accessChoices(r, data.words).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    ) : data.words[r.person]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <button type="submit">Save</button>}
      </form>

      <div className="card">
        <h2>Kept by their own rules</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {FIXED_DETAILS.map(d => <li key={d.label}><strong>{d.label}:</strong> {d.line}</li>)}
        </ul>
      </div>

      <div className="card">
        <h2>What each choice means</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }} className="small">
          {ACCESS_ORDER.map(a => <li key={a}><strong>{data.words[a]}</strong>: {MEANING[a]}</li>)}
        </ul>
      </div>
    </>
  );
}

const MEANING: Record<Access, string> = {
  hidden: 'the office keeps it; it isn’t shown in the app.',
  see: 'shown in the app; only the office changes it.',
  approve: 'they ask for a change in the app and it applies once an owner or administrator approves it.',
  change: 'they change it in the app straight away; the change is in the audit log.',
};
