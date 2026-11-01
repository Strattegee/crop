import Link from 'next/link';
import { api } from '../../../../../lib/api';
import { currentAgency } from '../../../../../lib/current-user';
import { T, words } from '../../../../../lib/terms';
import { Notices } from '../../../notices';
import { saveMatches } from './actions';

export const dynamic = 'force-dynamic';

type Requirement = {
  requirementId: string; name: string; category: string; hasExpiry: boolean; severity: 'hard' | 'warning' | 'optional'; neededFor: string[];
  match: { credentialTypeId: string; name: string; matchedBy: 'code' | 'hand'; matchedByName: string | null } | null;
  suggestion: { credentialTypeId: string; name: string } | null;
};
type View = { link: { otherName: string; status: 'matching' | 'active' | 'ended'; statusWords: string; unmatched: number; side: string; sitesWords?: string | null; rolesWords?: string | null }; requirements: Requirement[] };
type CredentialType = { id: string; name: string; active: boolean };
type ReadyPerson = { workerId: string; name: string; roles: string[]; ready: boolean; hasRole: boolean; missing: string[]; toCheck: string[] };
type ReadyGroup = { kind: 'role' | 'any' | 'duty'; label: string; unmatched: Array<{ name: string; severity: 'hard' | 'warning' }>; ready: number; summary: string; people: ReadyPerson[] };
type People = { onDate: string; peopleCount: number; groups: ReadyGroup[] };

const LEVEL: Record<Requirement['severity'], string> = { hard: 'Must have', warning: 'Should have', optional: 'Optional' };

/**
 * Matching an employer's requirements (agency side, backlog item 7, David's answer 1): each of the employer's
 * credential requirements is matched to one of this business's own credentials. A shared code suggests a match.
 */
export default async function MatchPage({ params, searchParams }: { params: Promise<{ connectionId: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { connectionId } = await params;
  const tw = await words();
  const [view, types, agency, sp, people] = await Promise.all([
    api<View>(`/agency-links/${connectionId}/requirements`), api<CredentialType[]>('/credential-types'), currentAgency(), searchParams,
    api<People>(`/agency-links/${connectionId}/people`).catch(() => null),
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const active = types.filter(t => t.active);
  const employer = view.link.otherName;

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> › <Link href="/settings/agencies">{tw.many(T.agency)}</Link> ›</p>
      <h1>Match {employer}’s requirements</h1>
      <p className="muted">
        For each credential {employer} asks for, choose the credential you record for it. Must have and should have need a match before {employer} can
        send you requests; optional ones help but aren’t needed. CROP then checks your people against {employer}’s requirements using your records;
        {` ${employer}`} never sees the records themselves, only which of its listed credentials your person held on the day (so they count towards
        its site cover and equipment operator checks). If {employer} adds a requirement later, you’ll be asked to match it.
      </p>
      <Notices error={sp.error} done={sp.done} />
      <div className={`notice ${view.link.status === 'active' ? 'success' : ''}`}>{view.link.statusWords}</div>
      {view.link.sitesWords && <p className="small">{tw.many(T.site)} you fill for {employer}: <b>{view.link.sitesWords}</b></p>}
      {view.link.rolesWords && <p className="small">{tw.many(T.role)} you fill for {employer}: <b>{view.link.rolesWords}</b></p>}
      {!canEdit && <div className="notice error">Only owners and administrators can change matches.</div>}

      {view.requirements.length === 0 ? (
        <div className="card"><p className="muted">{employer} has no credential requirements yet, so there is nothing to match.</p></div>
      ) : (
        <form action={saveMatches.bind(null, connectionId)} className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>{employer} asks for</th><th>Level</th><th>Needed for</th><th>Your credential</th></tr></thead>
            <tbody>
              {view.requirements.map(r => {
                const current = r.match?.credentialTypeId ?? '';
                const preset = current || r.suggestion?.credentialTypeId || '';
                return (
                  <tr key={r.requirementId}>
                    <td><b>{r.name}</b></td>
                    <td className="small">{LEVEL[r.severity]}</td>
                    <td className="small">{r.neededFor.join(', ')}</td>
                    <td>
                      <input type="hidden" name="req" value={r.requirementId} />
                      <input type="hidden" name={`cur:${r.requirementId}`} value={current} />
                      <select name={`m:${r.requirementId}`} defaultValue={preset} disabled={!canEdit} aria-label={`Your credential for ${r.name}`}>
                        <option value="">Not matched</option>
                        {active.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <div className="muted small">
                        {r.match ? `Matched${r.match.matchedBy === 'code' ? ' (same credential)' : ''}${r.match.matchedByName ? ` by ${r.match.matchedByName}` : ''}`
                          : r.suggestion ? 'Suggested: the same credential. Save to confirm.' : r.severity === 'optional' ? 'Optional' : 'Needs a match'}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {canEdit && <button type="submit" className="btn" style={{ marginTop: 12 }}>Save matches</button>}
          {canEdit && active.length === 0 && <p className="muted small">You have no credentials recorded yet. Add them under Compliance or from an industry template first.</p>}
        </form>
      )}

      {people && view.requirements.length > 0 && <PeopleReady people={people} employer={employer} workers={tw.lower(T.worker, true)} />}
    </>
  );
}

/**
 * Which of this business's people meet the employer's requirements today, before any shift arrives (David's answer 1):
 * one closed section per employer role (and per duty), ready people first, with what's missing for the rest.
 */
function PeopleReady({ people, employer, workers }: { people: People; employer: string; workers: string }) {
  return (
    <div className="card">
      <h2>Your {workers} against {employer}’s requirements</h2>
      <p className="muted small">
        Checked today against your own records, through the matches above: must-haves held, checked and current, and right to work in order.
        Should-haves and anything expiring soon are listed to check but don’t stop anyone. Shift times, leave and availability are checked when a request arrives.
        Different role names are fine: {employer}’s roles are only a guide.
      </p>
      {people.peopleCount === 0 && <p className="muted">You have no active {workers} to check yet.</p>}
      {people.groups.map(g => (
        <details key={`${g.kind}:${g.label}`} style={{ marginTop: 8 }}>
          <summary>
            <b>{g.kind === 'duty' ? `Shifts with ${g.label}` : g.label}</b> <span className="muted small">· {g.summary}</span>
          </summary>
          {g.kind === 'duty' && <p className="muted small">On top of the role’s requirements.</p>}
          {g.unmatched.filter(u => u.severity === 'warning').length > 0 && (
            <p className="muted small">Not matched yet (should have): {g.unmatched.filter(u => u.severity === 'warning').map(u => u.name).join(', ')}</p>
          )}
          {g.people.length > 0 && (
            <table className="small">
              <thead><tr><th>Name</th><th>Ready</th><th>What’s missing or to check</th></tr></thead>
              <tbody>
                {g.people.map(p => (
                  <tr key={p.workerId}>
                    <td><Link href={`/workers/${p.workerId}?tab=credentials`}>{p.name}</Link>{p.hasRole && <div className="muted small">Has the role</div>}</td>
                    <td>{p.ready ? <span className="badge ok">Ready</span> : <span className="badge bad">Not yet</span>}</td>
                    <td>
                      {p.missing.map(m => <div key={m}>{m}</div>)}
                      {p.toCheck.map(m => <div key={m} className="muted">{m} (to check)</div>)}
                      {!p.missing.length && !p.toCheck.length && <span className="muted">Nothing</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      ))}
    </div>
  );
}
