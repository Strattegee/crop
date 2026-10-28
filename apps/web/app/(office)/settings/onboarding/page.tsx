import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import {
  addChecklist, addStep, moveStep, removeStep, renameChecklist, setArchived, toggleRequired, type Checklist, type ChecklistStep,
} from './actions';

export const dynamic = 'force-dynamic';

type CredentialType = { id: string; name: string; active: boolean };

const KIND_LABEL: Record<string, string> = {
  task: 'Task the office ticks',
  credential: 'Credential checked and current',
  right_to_work: 'Right to work checked',
  employment: 'Employment terms set',
};

function StepRow({ c, s, i, canEdit }: { c: Checklist; s: ChecklistStep; i: number; canEdit: boolean }) {
  return (
    <tr>
      <td className="muted">{i + 1}</td>
      <td>
        <b>{s.title}</b>{!s.required && <span className="muted small"> · optional</span>}
        {s.help && <div className="muted small">{s.help}</div>}
      </td>
      <td className="muted small">{KIND_LABEL[s.kind] ?? s.kind}</td>
      <td>
        {canEdit && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <form action={moveStep.bind(null, c.id, s.id, -1)}><button className="btn small secondary" disabled={i === 0} aria-label={`Move ${s.title} up`}>↑</button></form>
            <form action={moveStep.bind(null, c.id, s.id, 1)}><button className="btn small secondary" disabled={i === c.steps.length - 1} aria-label={`Move ${s.title} down`}>↓</button></form>
            <form action={toggleRequired.bind(null, c.id, s.id)}><button className="btn small secondary">{s.required ? 'Make optional' : 'Make required'}</button></form>
            <form action={removeStep.bind(null, c.id, s.id)}><button className="btn small secondary" aria-label={`Take out ${s.title}`}>Take out</button></form>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Onboarding checklists (function 9130): what a new person needs before they can work. Tasks the office ticks, and
 * steps that tick themselves from the person's records (credentials, right to work, employment terms).
 */
export default async function OnboardingChecklistsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const tw = await words();
  const [checklists, types, agency, sp] = await Promise.all([
    api<Checklist[]>('/onboarding-checklists?archived=true'), api<CredentialType[]>('/credential-types'), currentAgency(), searchParams,
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const activeTypes = types.filter(t => t.active);
  const person = tw.lower(T.worker);

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>Onboarding checklists</h1>
      <p className="muted">
        What a new {person} needs before they can work. Some steps are tasks the office ticks, such as a signed contract or an induction. Others tick
        themselves when the {person}’s record is complete: a credential checked and current, right to work checked, employment terms set. Start a
        checklist when adding a {person}, or from their page; they stay off the {tw.lower(T.roster)} until an owner or admin finishes it.
      </p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can change checklists.</div>}

      {checklists.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>No checklists yet. Add one below.</p></div>}

      {checklists.map(c => (
        <div key={c.id} className="card" style={{ overflowX: 'auto', opacity: c.archived ? 0.6 : 1 }}>
          <h2 style={{ marginBottom: 4 }}>{c.name}{c.archived && <span className="muted"> (put away)</span>}</h2>
          {c.description && <p className="muted" style={{ marginTop: 0 }}>{c.description}</p>}
          <p className="muted small" style={{ marginTop: 0 }}>
            {c.steps.length} step{c.steps.length === 1 ? '' : 's'}, {c.steps.filter(s => s.required).length} required
            {c.inProgress > 0 && <> · {c.inProgress} {c.inProgress === 1 ? person : tw.lower(T.worker, true)} being onboarded with it</>}
          </p>
          {c.steps.length > 0 && (
            <table>
              <thead><tr><th /><th>Step</th><th>How it’s done</th><th /></tr></thead>
              <tbody>{c.steps.map((s, i) => <StepRow key={s.id} c={c} s={s} i={i} canEdit={canEdit} />)}</tbody>
            </table>
          )}
          {canEdit && !c.archived && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer' }}>Add a step</summary>
              <form action={addStep.bind(null, c.id)} className="form-row" style={{ marginTop: 8 }}>
                <label>What
                  <select name="what" defaultValue="task">
                    <option value="task">A task the office ticks</option>
                    {!c.steps.some(s => s.kind === 'right_to_work') && <option value="right_to_work">Right to work checked</option>}
                    {!c.steps.some(s => s.kind === 'employment') && <option value="employment">Employment terms set</option>}
                    {activeTypes.filter(t => !c.steps.some(s => s.credentialTypeId === t.id)).map(t => <option key={t.id} value={`cred:${t.id}`}>Credential: {t.name}</option>)}
                  </select>
                </label>
                <label>Title<input name="title" maxLength={120} placeholder="e.g. Contract signed (blank for a credential)" /></label>
                <label>Help<input name="help" maxLength={300} placeholder="Optional, e.g. Use the 2026 contract" /></label>
                <label className="inline"><input type="checkbox" name="required" defaultChecked /> Required</label>
                <button type="submit" className="btn small">Add step</button>
              </form>
            </details>
          )}
          {canEdit && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer' }}>Rename or put away</summary>
              <form action={renameChecklist.bind(null, c.id)} className="form-row" style={{ marginTop: 8 }}>
                <label>Name<input name="name" defaultValue={c.name} maxLength={80} required /></label>
                <label>Description<input name="description" defaultValue={c.description ?? ''} maxLength={300} /></label>
                <button type="submit" className="btn small">Save</button>
              </form>
              <form action={setArchived.bind(null, c.id, !c.archived)} style={{ marginTop: 6 }}>
                <button type="submit" className="btn small secondary">{c.archived ? 'Bring back into use' : 'Put away'}</button>
              </form>
            </details>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="card">
          <h2>Add a checklist</h2>
          <form action={addChecklist}>
            <div className="form-row">
              <label>Name<input name="name" required maxLength={80} placeholder="e.g. New kitchen staff" /></label>
              <label>Description<input name="description" maxLength={300} /></label>
            </div>
            <div className="form-row">
              <label className="inline"><input type="checkbox" name="fromRequirements" defaultChecked /> Start from our credential rules (right to work, employment terms and the credentials {tw.lower(T.worker, true)} must or should hold)</label>
              <label>For roles<input name="roles" maxLength={200} placeholder="Optional, e.g. CHEF, BARISTA" /></label>
            </div>
            <button type="submit" className="btn">Add checklist</button>
          </form>
        </div>
      )}
    </>
  );
}
