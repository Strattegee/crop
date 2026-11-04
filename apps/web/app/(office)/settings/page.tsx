import Link from 'next/link';
import { api } from '../../../lib/api';
import { currentAgency } from '../../../lib/current-user';
import { CATEGORY_LABEL } from '../../../lib/format';
import { Notices } from '../notices';
import { addCredentialType, addRole, addRule, removeRule, saveSettings, setAdultRoles, setTypeActive } from './actions';
import { industryGroups, needsHeadings } from '../../../lib/industry-groups';
import { addDemoStaff, applyPack, completeDemo } from './industry-actions';
import { T, words } from '../../../lib/terms';
import { saveTerms } from './terms-actions';
import { COUNTRIES, zoneName } from '../../../lib/places';

export const dynamic = 'force-dynamic';

type CredentialType = { id: string; name: string; category: string; hasNumber: boolean; hasExpiry: boolean; verificationMethod: string | null; active: boolean; industries?: string[] };
type Role = { id: string; name: string; area: string | null; active: boolean; adultsOnly?: boolean; workerCount: number; industries?: string[] };
type Rule = { id: string; typeName: string; scope: string; role: string | null; severity: string };
const LEVEL_LABEL: Record<string, string> = { hard: 'Must have', warning: 'Should have', optional: 'Optional' };
type PackSummary = { id: string; name: string; description: string; appliedAt: string | null; counts: { roles: number; credentials: number; shiftCodes: number; equipmentTypes: number; items: number; duties?: number } };
type Settings = { expiringWindowDays: number; timezone: string; country?: string; smsMonthlyCap: number; publishedChanges: 'open' | 'managers' | 'locked'; shiftSwaps?: 'off' | 'approve' | 'automatic'; distanceFreeKm?: number };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const tw = await words();
  const [packs, types, rules, settings, agency, sp, roles] = await Promise.all([
    api<PackSummary[]>('/industry-packs'), api<CredentialType[]>('/credential-types'), api<Rule[]>('/credential-requirements'), api<Settings>('/settings'), currentAgency(), searchParams,
    api<Role[]>('/roles').catch(() => [] as Role[]),
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  // Grouped by the industries this business works in (David, 31 Oct).
  const typeGroups = industryGroups(types, packs);
  const activeTypeGroups = industryGroups(types.filter(t => t.active), packs);
  const roleGroups = industryGroups(roles.filter(r => r.active), packs);
  // Roles on the business's list (not only typed on a person) can be set as 18 and over only.
  const listedRoles = roles.filter(r => r.active && !r.id.startsWith('name:')).sort((a, b) => a.name.localeCompare(b.name));
  const adultRoleCount = listedRoles.filter(r => r.adultsOnly).length;

  return (
    <>
      <h1>Settings</h1>
      <p className="muted">Industry templates, credential types, the rules for who needs them, and compliance settings.</p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can change these settings.</div>}

      <div className="card">
        <h2>Industry templates</h2>
        <p className="muted" style={{ marginTop: 0 }}>Pick the industries this business works in. Each adds starter roles, the credentials each role needs, shift types, shift duties (such as serving alcohol), equipment types and stock items. Apply as many as you like; nothing is duplicated, and you can change or switch off anything afterwards. Templates are a starting point, not legal advice: check your state&apos;s requirements.{' '}They are the {COUNTRIES[(settings.country ?? 'AU') as keyof typeof COUNTRIES]?.name ?? 'Australia'} versions, with that country&apos;s usual credentials and licences (the business&apos;s country is set under Business settings below); anything already added stays as it is if the country changes.</p>
        <div className="grid">
          {packs.map(p => (
            <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong>{p.name}{p.appliedAt && <span className="badge ok" style={{ marginLeft: 6 }}>Applied</span>}</strong>
              <span className="muted" style={{ fontSize: 13 }}>{p.description}</span>
              <span className="muted" style={{ fontSize: 12 }}>{p.counts.roles} roles · {p.counts.credentials} credentials · {p.counts.shiftCodes} shift types · {p.counts.equipmentTypes} equipment types · {p.counts.items} items{p.counts.duties ? ` · ${p.counts.duties} shift duties` : ''}</span>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                  <form action={applyPack.bind(null, p.id)}><button type="submit" className={`btn small ${p.appliedAt ? 'secondary' : ''}`}>{p.appliedAt ? 'Apply again' : 'Use this template'}</button></form>
                  {process.env.DEMO_TOOLS === 'on' && p.appliedAt && (
                    <form action={addDemoStaff.bind(null, p.id)}><button type="submit" className="btn small secondary">Add demo staff</button></form>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {process.env.DEMO_TOOLS === 'on' && canEdit && (
          <form action={completeDemo} style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="muted small">Demo only: give invented demo staff any credentials your current rules require.</span>
            <button className="btn small secondary">Complete demo staff credentials</button>
          </form>
        )}
      </div>

      {canEdit && (
        <div className="card">
          <h2>Audit log</h2>
          <p className="muted" style={{ marginTop: 0 }}>Every record added, changed or removed: who, when, and the values before and after. Nobody can change it.</p>
          <Link href="/settings/audit" className="btn small secondary">Audit log</Link>
        </div>
      )}

      <div className="card">
        <h2>Personal details</h2>
        <p className="muted" style={{ marginTop: 0 }}>Who can see and change each piece of a {tw.lower(T.worker)}’s details in the app: office only, a look, a change you approve, or their own change.</p>
        <Link href="/settings/personal-details" className="btn small secondary">Personal details</Link>
      </div>

      <div className="card">
        <h2>Team access</h2>
        <p className="muted" style={{ marginTop: 0 }}>Which {tw.lower(T.site, true)} and {tw.lower(T.project, true)} each allocator and supervisor works on. Supervisors see only theirs, and only what relates to the {tw.lower(T.shift, true)} there.</p>
        <Link href="/settings/team-access" className="btn small secondary">Team access</Link>
      </div>

      <div className="card">
        <h2>Offices</h2>
        <p className="muted" style={{ marginTop: 0 }}>Your branches: which {tw.lower(T.site, true)} and which people in the office belong to each. Allocations and the dashboard can be narrowed to one office.</p>
        <Link href="/settings/offices" className="btn small secondary">Offices</Link>
      </div>

      <div className="card">
        <h2>Dashboards</h2>
        <p className="muted" style={{ marginTop: 0 }}>Which dashboard each person in the office lands on, who sees cost figures, and your business’s own targets.</p>
        <Link href="/settings/dashboards" className="btn small secondary">Dashboards</Link>
      </div>

      <div className="card">
        <h2>Shift types</h2>
        <p className="muted" style={{ marginTop: 0 }}>Your usual shifts, each with a letter for the {tw.lower(T.roster)}, a name and standard hours (for example D, Day shift, 7:00–3:30).</p>
        <Link href="/settings/shift-types" className="btn small secondary">Shift types</Link>
      </div>

      <div className="card">
        <h2>Shift duties</h2>
        <p className="muted" style={{ marginTop: 0 }}>Extra duties a {tw.lower(T.shift)} can carry, such as serving alcohol, each with the credentials it needs. Tick them on a {tw.lower(T.shift)} in the {tw.lower(T.roster)}.</p>
        <Link href="/settings/shift-duties" className="btn small secondary">Shift duties</Link>
      </div>

      <div className="card">
        <h2>Cover rules</h2>
        <p className="muted" style={{ marginTop: 0 }}>Credentials someone on {tw.lower(T.shift)} must hold whenever anyone is working, such as a food safety supervisor. The {tw.lower(T.roster)} shows any gaps.</p>
        <Link href="/settings/cover-rules" className="btn small secondary">Cover rules</Link>
      </div>

      <div className="card">
        <h2>Onboarding checklists</h2>
        <p className="muted" style={{ marginTop: 0 }}>What a new {tw.lower(T.worker)} needs before they can work: tasks the office ticks, and checks that tick themselves when their record is complete.</p>
        <Link href="/settings/onboarding" className="btn small secondary">Onboarding checklists</Link>
      </div>

      <div className="card">
        <h2>{tw.many(T.agency)}</h2>
        <p className="muted" style={{ marginTop: 0 }}>Link with {tw.lower(T.agency, true)} that also use CROP, in the order you’d ask them, and see the businesses you supply.</p>
        <Link href="/settings/agencies" className="btn small secondary">{tw.many(T.agency)}</Link>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Words we use</h2>
        <p className="muted" style={{ marginTop: 0 }}>Call things what your business calls them. Menus, page titles and the {tw.lower(T.roster)} use these words. Leave a word blank to go back to the standard one.</p>
        <form action={saveTerms}>
          <table>
            <thead><tr><th>Standard word</th><th>Your word (one)</th><th>Your word (more than one)</th></tr></thead>
            <tbody>
              {tw.all.map(t => (
                <tr key={t.code}>
                  <td>{t.defaultSingular}<div className="muted small">{t.concept}</div></td>
                  <td><input type="hidden" name="code" value={t.code} /><input name={`singular-${t.code}`} defaultValue={t.singular === t.defaultSingular ? '' : t.singular} placeholder={t.defaultSingular} maxLength={40} disabled={!canEdit} /></td>
                  <td><input name={`plural-${t.code}`} defaultValue={t.plural === t.defaultPlural ? '' : t.plural} placeholder={t.defaultPlural} maxLength={40} disabled={!canEdit} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && <button type="submit" className="btn" style={{ marginTop: 10 }}>Save words</button>}
        </form>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>{tw.one(T.credential)} types</h2>
        {types.length === 0 && (
          <p className="muted">None yet. Apply an industry template above to add the {tw.lower(T.credential, true)} for your industries, or add your own below.</p>
        )}
        {types.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Category</th><th>Number</th><th>Expiry</th><th>How it's verified</th><th /></tr></thead>
            <tbody>
              {typeGroups.map(g => [
                needsHeadings(typeGroups) && <tr key={`g-${g.key}`} className="grp-row"><th colSpan={6}>{g.label} <span className="muted">({g.items.length})</span></th></tr>,
                ...g.items.map(t => (
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
                )),
              ])}
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

      <div className="card">
        <h2>{tw.many(T.role)}</h2>
        <p className="muted" style={{ marginTop: 0 }}>The {tw.lower(T.role, true)} in this business, grouped by industry. The number is how many active {tw.lower(T.worker, true)} have each one.</p>
        {roleGroups.length === 0 ? <p className="muted">None yet. Apply an industry template above, or add one below.</p> : roleGroups.map(g => (
          <div key={g.key} className="chip-group">
            {needsHeadings(roleGroups) && <h3>{g.label}</h3>}
            <div className="chips">{g.items.map(r => <span key={r.id} className="chip">{r.name}{r.adultsOnly && <b className="badge warn" title="18 and over only" style={{ marginLeft: 4 }}>18+</b>}<span className="muted"> {r.workerCount}</span></span>)}</div>
          </div>
        ))}
        {canEdit && (
          <form action={addRole} className="form-row" style={{ marginTop: 12 }}>
            <label>New {tw.lower(T.role)}<input name="name" required maxLength={60} placeholder="e.g. Barista" /></label>
            <label>{tw.one(T.area)} <span className="muted">(optional)</span><input name="area" maxLength={60} /></label>
            <label className="inline"><input type="checkbox" name="adultsOnly" /> 18 and over only</label>
            <button type="submit" className="btn secondary">Add {tw.lower(T.role)}</button>
          </form>
        )}
        {canEdit && listedRoles.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer' }}>18 and over only{adultRoleCount ? ` (${adultRoleCount})` : ''}</summary>
            <p className="muted small">Tick the {tw.lower(T.role, true)} that only people aged 18 and over should do. Putting someone under 18 (by the date of birth on their record) on one shows a warning, never a block: the office decides, because the rules differ by state and kind of work. Someone under 18 on a {tw.lower(T.shift)} between 10pm and 6am gets a warning too.</p>
            <form action={setAdultRoles}>
              <div className="chips">{listedRoles.map(r => (
                <label key={r.id} className="chip inline">
                  <input type="hidden" name="ids" value={r.id} />
                  {r.adultsOnly && <input type="hidden" name="was" value={r.id} />}
                  <input type="checkbox" name="adult" value={r.id} defaultChecked={!!r.adultsOnly} /> {r.name}
                </label>
              ))}</div>
              <button type="submit" className="btn secondary" style={{ marginTop: 8 }}>Save</button>
            </form>
          </details>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Who needs what</h2>
        <p className="muted" style={{ marginTop: 0 }}><strong>Must have</strong> stops a worker being compliant and being put on a shift. <strong>Should have</strong> is shown as a warning but doesn't block. <strong>Optional</strong> is listed on the person's page so everyone knows it's useful, but it's never checked or warned about. Rules for particular clients and sites come with the client module.</p>
        {rules.length === 0 ? <p className="muted">No rules yet.</p> : (
          <table>
            <thead><tr><th>Credential</th><th>Applies to</th><th>Level</th><th /></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id}>
                  <td>{r.typeName}</td>
                  <td>{r.scope === 'all_workers' ? 'All workers' : `Role: ${r.role}`}</td>
                  <td>{LEVEL_LABEL[r.severity] ?? r.severity}</td>
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
                {activeTypeGroups.map(g => (
                  <optgroup key={g.key} label={g.label}>{g.items.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
                ))}
              </select>
            </label>
            <label>Applies to
              <select name="roleChoice" defaultValue="">
                <option value="">All {tw.lower(T.worker, true)}</option>
                {roleGroups.map(g => (
                  <optgroup key={g.key} label={g.label}>{g.items.map(r => <option key={r.id} value={r.name}>{tw.one(T.role)}: {r.name}</option>)}</optgroup>
                ))}
              </select>
            </label>
            <label>or another {tw.lower(T.role)} <span className="muted">(optional)</span><input name="role" maxLength={60} placeholder="Type it exactly as on people" /></label>
            <label>Level
              <select name="severity" defaultValue="hard"><option value="hard">Must have</option><option value="warning">Should have (a warning)</option><option value="optional">Optional (listed, never checked)</option></select>
            </label>
            <button type="submit" className="btn">Add rule</button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Business settings</h2>
        <form action={saveSettings} className="form-row">
          <label>Show as expiring this many days ahead<input name="expiringWindowDays" type="number" min={1} max={365} defaultValue={settings.expiringWindowDays} disabled={!canEdit} /></label>
          <label>Country
            <select name="country" defaultValue={settings.country ?? 'AU'} disabled={!canEdit}>
              {Object.entries(COUNTRIES).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}
            </select>
          </label>
          <label>Time zone (for &quot;today&quot; and reminders; each site keeps its own)
            <select name="timezone" defaultValue={settings.timezone} disabled={!canEdit}>
              {Object.entries(COUNTRIES).map(([k, c]) => (
                <optgroup key={k} label={c.name}>{c.zones.map(z => <option key={z} value={z}>{zoneName(z)}</option>)}</optgroup>
              ))}
            </select>
          </label>
          <label>Monthly text limit<input name="smsMonthlyCap" type="number" min={0} max={1000000} defaultValue={settings.smsMonthlyCap} disabled={!canEdit} /></label>
          <label>After a week&apos;s roster is published
            <select name="publishedChanges" defaultValue={settings.publishedChanges ?? 'open'} disabled={!canEdit}>
              <option value="open">Anyone in the office can change it</option>
              <option value="managers">Only owners and admins can change it (others ask for approval)</option>
              <option value="locked">Nobody can change it (turned off)</option>
            </select>
          </label>
          <label>{tw.one(T.shift)} swaps in the app
            <select name="shiftSwaps" defaultValue={settings.shiftSwaps ?? 'off'} disabled={!canEdit}>
              <option value="off">Off</option>
              <option value="approve">On: the colleague agrees, then an owner or admin approves</option>
              <option value="automatic">On: made as soon as the colleague agrees</option>
            </select>
          </label>
          <label>Distance from home counts beyond (km; blank or 0 = never)
            <input name="distanceFreeKm" type="number" min={0} max={1000} defaultValue={settings.distanceFreeKm ? settings.distanceFreeKm : ''} disabled={!canEdit} />
          </label>
          {canEdit && <button type="submit" className="btn">Save</button>}
        </form>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>When ranking people for a {tw.lower(T.shift)}, anyone who lives further than this from the {tw.lower(T.site)} (straight line between postcodes) comes after the others who are just as suitable, nearer first in 10 km steps; within it, or when we don't know, distance makes no difference. It never stops anyone being offered or booked. Texts over the monthly limit aren't sent; they show as "Not sent" in Messages. Every change to a published roster is recorded with who made it. Staff can still accept offers they were sent unless changes are turned off. When someone can't make a change themselves, they can ask for it on the roster, and an owner or admin approves or declines it. With {tw.lower(T.shift)} swaps on, {tw.lower(T.worker, true)} with the app can ask a colleague to take one of their published {tw.lower(T.shift, true)} or swap it for one of theirs; only colleagues who meet every rule for it are offered, and swaps waiting for approval show on the Dashboard.</p>
      </div>
    </>
  );
}
