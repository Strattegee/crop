import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { industryGroups, needsHeadings, type IndustryGroup, type PackInfo } from '../../../../lib/industry-groups';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { addDuty, saveDuty, setDutyActive } from './actions';

export const dynamic = 'force-dynamic';

type Duty = {
  id: string; name: string; description: string | null; active: boolean; industries?: string[];
  requirements: { credentialTypeId: string; typeName: string; severity: 'hard' | 'warning' | 'optional' }[];
};
type CredentialType = { id: string; name: string; active: boolean; industries?: string[] };

function NeedsFields({ groups, duty }: { groups: IndustryGroup<CredentialType>[]; duty?: Duty }) {
  if (!groups.length) return <p className="muted small">No credentials yet. Add them under Compliance first.</p>;
  return (
    <fieldset className="duty-needs">
      <legend>What it needs</legend>
      {groups.map(g => (
        <div key={g.key}>
          {needsHeadings(groups) && <h4 className="grp-head">{g.label}</h4>}
          {g.items.map(t => {
            const r = duty?.requirements.find(x => x.credentialTypeId === t.id);
            return (
              <label key={t.id} className="inline">
                <span>{t.name}</span>
                <select name={`req_${t.id}`} defaultValue={r ? ({ hard: 'must', warning: 'should', optional: 'optional' } as const)[r.severity] : ''}>
                  <option value="">Not needed</option>
                  <option value="must">Must have</option>
                  <option value="should">Should have (a warning)</option>
                  <option value="optional">Optional (listed, never checked)</option>
                </select>
              </label>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}

/**
 * Shift duties (function 9110): things a shift may involve, such as serving alcohol, each with the credentials
 * whoever works it needs. Ticked on a shift in the roster's side panel.
 */
export default async function ShiftDutiesPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; edit?: string }> }) {
  const tw = await words();
  const [duties, types, agency, sp, packs] = await Promise.all([
    api<Duty[]>('/shift-duties'), api<CredentialType[]>('/credential-types'), currentAgency(), searchParams,
    api<PackInfo[]>('/industry-packs').catch(() => [] as PackInfo[]),
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const typeGroups = industryGroups(types.filter(t => t.active), packs);
  const dutyGroups = industryGroups(duties, packs);
  const editing = canEdit && sp.edit ? duties.find(d => d.id === sp.edit) : undefined;
  const shift = tw.lower(T.shift);

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>Shift duties</h1>
      <p className="muted">
        Some {tw.lower(T.shift, true)} involve extra duties, such as serving alcohol or being the food safety supervisor on site. Each duty lists the
        credentials it needs. Tick a duty on a {shift} in the {tw.lower(T.roster)} and whoever works that {shift} must also meet it, so someone whose
        RSA has run out can still work a {shift} with no bar service.
      </p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can change shift duties.</div>}

      {editing && (
        <div className="card">
          <h2>Change {editing.name}</h2>
          <form action={saveDuty.bind(null, editing.id)}>
            <div className="form-row">
              <label>Name<input name="name" defaultValue={editing.name} maxLength={80} required /></label>
              <label>Description<input name="description" defaultValue={editing.description ?? ''} maxLength={300} /></label>
            </div>
            <NeedsFields groups={typeGroups} duty={editing} />
            <div className="form-row">
              <button type="submit" className="btn">Save</button>
              <Link href="/settings/shift-duties" className="btn secondary">Cancel</Link>
            </div>
          </form>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        {duties.length === 0 ? (
          <p className="muted">No duties yet. Add one below.</p>
        ) : (
          <table>
            <thead><tr><th>Duty</th><th>Needs</th><th /></tr></thead>
            <tbody>
              {dutyGroups.map(g => [
                needsHeadings(dutyGroups) && <tr key={`g-${g.key}`} className="grp-row"><th colSpan={3}>{g.label} <span className="muted">({g.items.length})</span></th></tr>,
                ...g.items.map(d => (
                <tr key={d.id} style={{ opacity: d.active ? 1 : 0.5 }}>
                  <td><b>{d.name}</b>{!d.active && ' (off)'}{d.description && <div className="muted small">{d.description}</div>}</td>
                  <td>
                    {d.requirements.length === 0 ? <span className="muted">Nothing yet</span> : d.requirements.map(r => (
                      <div key={r.credentialTypeId}>{r.typeName} <span className="muted small">· {({ hard: 'must have', warning: 'should have', optional: 'optional' } as const)[r.severity]}</span></div>
                    ))}
                  </td>
                  <td>
                    {canEdit && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Link href={`/settings/shift-duties?edit=${d.id}`} className="btn small secondary">Change</Link>
                        <form action={setDutyActive.bind(null, d.id, !d.active)}>
                          <button type="submit" className="btn small secondary">{d.active ? 'Switch off' : 'Switch on'}</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
                )),
              ])}
            </tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <div className="card">
          <h2>Add a duty</h2>
          <form action={addDuty}>
            <div className="form-row">
              <label>Name<input name="name" required maxLength={80} placeholder="e.g. Serves alcohol" /></label>
              <label>Description<input name="description" maxLength={300} placeholder="e.g. The bar is open" /></label>
            </div>
            <NeedsFields groups={typeGroups} />
            <button type="submit" className="btn">Add</button>
          </form>
        </div>
      )}
    </>
  );
}
