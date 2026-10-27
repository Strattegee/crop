import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { addCoverRule, setCoverRuleActive } from './actions';

export const dynamic = 'force-dynamic';

type Rule = { id: string; facilityId: string | null; facilityName: string | null; credentialTypeId: string; typeName: string; active: boolean };
type CredentialType = { id: string; name: string; active: boolean };
type Facility = { id: string; name: string; active: boolean };

/**
 * Cover rules (function 9120): credentials that someone on shift must hold whenever anyone is working at a site,
 * such as a food safety supervisor. Met by the people on shift together, so gaps are shown, never refused.
 */
export default async function CoverRulesPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const tw = await words();
  const [rules, types, facilities, agency, sp] = await Promise.all([
    api<Rule[]>('/cover-rules'), api<CredentialType[]>('/credential-types'), api<Facility[]>('/facilities'), currentAgency(), searchParams,
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const site = tw.lower(T.site);
  const shift = tw.lower(T.shift);

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>Cover rules</h1>
      <p className="muted">
        Some credentials have to be on {shift} whenever anyone is working, such as a food safety supervisor or a first aid officer. A cover rule
        doesn’t stop you putting anyone on a {shift}: it’s met by everyone on {shift} together. The {tw.lower(T.roster)} and Needs attention show any
        times when people are working but nobody working holds the credential (only verified credentials that haven’t run out count).
      </p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can change cover rules.</div>}

      <div className="card" style={{ overflowX: 'auto' }}>
        {rules.length === 0 ? (
          <p className="muted">No cover rules yet.{canEdit && ' Add one below.'}</p>
        ) : (
          <table>
            <thead><tr><th>Someone on {shift} must hold</th><th>At</th><th /></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td><b>{r.typeName}</b>{!r.active && ' (off)'}</td>
                  <td>{r.facilityName ?? `Every ${site}`}</td>
                  <td>
                    {canEdit && (
                      <form action={setCoverRuleActive.bind(null, r.id, !r.active)}>
                        <button type="submit" className="btn small secondary">{r.active ? 'Switch off' : 'Switch on'}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <div className="card">
          <h2>Add a cover rule</h2>
          {types.filter(t => t.active).length === 0 ? (
            <p className="muted small">No credentials yet. Add them under Compliance first.</p>
          ) : (
            <form action={addCoverRule}>
              <div className="form-row">
                <label>Someone on {shift} must hold
                  <select name="credentialTypeId" required defaultValue="">
                    <option value="" disabled>Choose a credential</option>
                    {types.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label>At
                  <select name="facilityId" defaultValue="">
                    <option value="">Every {site}</option>
                    {facilities.filter(f => f.active).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
              </div>
              <button type="submit" className="btn">Add</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
