import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { CATEGORY_LABEL } from '../../../lib/format';
import { Notices } from '../notices';
import { addCredentialType, addRule, addStarterSet, removeRule, saveSettings, setTypeActive } from './actions';

export const dynamic = 'force-dynamic';

type CredentialType = { id: string; name: string; category: string; hasNumber: boolean; hasExpiry: boolean; verificationMethod: string | null; active: boolean };
type Rule = { id: string; typeName: string; scope: string; role: string | null; severity: string };
type Settings = { expiringWindowDays: number; timezone: string };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [types, rules, settings, agency, sp] = await Promise.all([
    api<CredentialType[]>('/credential-types'), api<Rule[]>('/credential-requirements'), api<Settings>('/settings'), currentAgency(), searchParams,
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';

  return (
    <>
      <h1>Settings</h1>
      <p className="muted">Credential types, the rules for who needs them, and compliance settings.</p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can change these settings.</div>}

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Credential types</h2>
        {types.length === 0 && canEdit && (
          <form action={addStarterSet} style={{ marginBottom: 12 }}>
            <p className="muted">Start with the suggested list for a nursing agency (AHPRA, police check, WWCC, NDIS screening, CPR, vaccinations and more). You can change or switch off any of them.</p>
            <button type="submit" className="btn">Add suggested credential types</button>
          </form>
        )}
        {types.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Category</th><th>Number</th><th>Expiry</th><th>How it's verified</th><th /></tr></thead>
            <tbody>
              {types.map(t => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                  <td>{t.name}{!t.active && ' (off)'}</td>
                  <td>{CATEGORY_LABEL[t.category] ?? t.category}</td>
                  <td>{t.hasNumber ? 'Yes' : 'No'}</td>
                  <td>{t.hasExpiry ? 'Yes' : 'No'}</td>
                  <td>{t.verificationMethod ?? '—'}</td>
                  <td>
                    {canEdit && (
                      <form action={setTypeActive.bind(null, t.id, !t.active)}>
                        <button type="submit" className="btn small secondary">{t.active ? 'Switch off' : 'Switch on'}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer' }}>Add a credential type</summary>
            <form action={addCredentialType} className="form-row" style={{ marginTop: 12 }}>
              <label>Name<input name="name" required maxLength={120} /></label>
              <label>Category
                <select name="category" required>
                  {Object.entries(CATEGORY_LABEL).filter(([v]) => v !== 'right_to_work').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>How it's verified<input name="verificationMethod" maxLength={300} placeholder="e.g. Sight the certificate" /></label>
              <label style={{ flexDirection: 'row', alignItems: 'center', flex: '0 0 auto' }}><input type="checkbox" name="hasNumber" defaultChecked /> Has a number</label>
              <label style={{ flexDirection: 'row', alignItems: 'center', flex: '0 0 auto' }}><input type="checkbox" name="hasExpiry" defaultChecked /> Expires</label>
              <button type="submit" className="btn">Add</button>
            </form>
          </details>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Who needs what</h2>
        <p className="muted" style={{ marginTop: 0 }}>A <strong>hard</strong> rule stops a worker being compliant (and, once rostering arrives, being booked). A <strong>warning</strong> is shown but doesn't block. Rules for particular clients and facilities come with the client module.</p>
        {rules.length === 0 ? <p className="muted">No rules yet.</p> : (
          <table>
            <thead><tr><th>Credential</th><th>Applies to</th><th>Type</th><th /></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id}>
                  <td>{r.typeName}</td>
                  <td>{r.scope === 'all_workers' ? 'All workers' : `Role: ${r.role}`}</td>
                  <td>{r.severity === 'hard' ? 'Hard' : 'Warning'}</td>
                  <td>{canEdit && <form action={removeRule.bind(null, r.id)}><button type="submit" className="btn small secondary">Remove</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && types.length > 0 && (
          <form action={addRule} className="form-row" style={{ marginTop: 12 }}>
            <label>Credential
              <select name="credentialTypeId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {types.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>Role (leave blank for all workers)<input name="role" maxLength={40} placeholder="e.g. RN" /></label>
            <label>Type
              <select name="severity" defaultValue="hard"><option value="hard">Hard</option><option value="warning">Warning</option></select>
            </label>
            <button type="submit" className="btn">Add rule</button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Compliance settings</h2>
        <form action={saveSettings} className="form-row">
          <label>Show as expiring this many days ahead<input name="expiringWindowDays" type="number" min={1} max={365} defaultValue={settings.expiringWindowDays} disabled={!canEdit} /></label>
          <label>Agency time zone
            <select name="timezone" defaultValue={settings.timezone} disabled={!canEdit}>
              {['Australia/Melbourne', 'Australia/Sydney', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin']
                .map(tz => <option key={tz} value={tz}>{tz.replace('Australia/', '')}</option>)}
            </select>
          </label>
          {canEdit && <button type="submit" className="btn">Save</button>}
        </form>
      </div>
    </>
  );
}
