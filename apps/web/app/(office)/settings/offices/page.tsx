import Link from 'next/link';
import { api } from '../../../../lib/api';
import { businessSettings } from '../../../../lib/business';
import { currentAgency } from '../../../../lib/current-user';
import { STATES, US_STATES } from '../../../../lib/places';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { addOffice, setOfficeActive, setOfficePeople, setSiteOffice, updateOffice } from './actions';

export const dynamic = 'force-dynamic';

type Office = {
  id: string; name: string; state: string | null; active: boolean; siteCount: number; mine: boolean;
  sites: { id: string; name: string; active: boolean }[]; people: { userId: string; name: string }[];
};
type Person = { userId: string; name: string; role: string };
type Site = { id: string; name: string; clientName: string | null; state: string | null; officeId: string | null; active: boolean };

const ROLE: Record<string, string> = { owner: 'Owner', admin: 'Administrator', allocator: 'Allocator' };

/** The state field for the business's country: a list for Australia and the US, else a free text region. */
function StateField({ country, value }: { country: string; value?: string | null }) {
  const list = country === 'AU' ? STATES : country === 'US' ? US_STATES : null;
  const label = country === 'GB' ? 'County' : country === 'NZ' ? 'Region' : 'State';
  return list ? (
    <label>{label} (optional)
      <select name="state" defaultValue={value ?? ''}>
        <option value="">None</option>
        {list.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </label>
  ) : <label>{label} (optional)<input name="state" defaultValue={value ?? ''} maxLength={60} /></label>;
}

/**
 * Settings › Offices (function 9170, David, 3 Nov 2026): the business's branches, such as "VIC Melbourne Metro".
 * Each site belongs to one office and office people can be attached to offices; Allocations then starts each person
 * on their offices' shifts, and the dashboard's live numbers drill down by office.
 */
export default async function OfficesPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [tw, agency, offices, sites, settings, sp] = await Promise.all([
    words(), currentAgency(), api<Office[]>('/offices'), api<Site[]>('/facilities'), businessSettings(), searchParams,
  ]);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const people = canEdit ? await api<Person[]>('/offices/people').catch(() => [] as Person[]) : [];
  const country = settings.country ?? 'AU';
  const live = offices.filter(o => o.active);
  const site = tw.lower(T.site), sitesWord = tw.lower(T.site, true);
  const activeSites = sites.filter(s => s.active);
  const without = activeSites.filter(s => !s.officeId).length;

  return (
    <>
      <p className="muted small"><Link href="/settings">Settings</Link> ›</p>
      <h1>Offices</h1>
      <p className="muted">
        Your branches, such as “VIC Melbourne Metro” or “QLD Sunshine Coast”. Each {site} belongs to one office, and the people in your office
        can be attached to the offices they work for. Allocations starts each person on their own offices’ {tw.lower(T.shift, true)} (everyone can
        still see all of them), and the dashboard’s numbers can be narrowed to one office.
      </p>
      <Notices error={sp.error} done={sp.done} />
      {!canEdit && <div className="notice error">Only owners and administrators can change offices.</div>}

      {offices.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No offices yet. Until you add one, Allocations groups {tw.lower(T.shift, true)} by state.</p></div>
      ) : offices.map(o => (
        <div key={o.id} className="card" style={{ opacity: o.active ? 1 : 0.6 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{o.name}</h2>
            {o.state && <span className="muted">{o.state}</span>}
            {!o.active && <span className="muted">(switched off)</span>}
            {o.mine && <span className="badge neutral">Yours</span>}
          </div>
          <p className="small" style={{ margin: '8px 0 4px' }}>
            <strong>{tw.many(T.site)}:</strong>{' '}
            {o.sites.length ? o.sites.map((s, i) => <span key={s.id}>{i > 0 && ', '}<Link href={`/facilities/${s.id}`}>{s.name}</Link>{!s.active && ' (inactive)'}</span>)
              : <span className="muted">none yet</span>}
          </p>
          <p className="small" style={{ margin: '4px 0' }}>
            <strong>People:</strong> {o.people.length ? o.people.map(p => p.name).join(', ') : <span className="muted">nobody attached</span>}
          </p>
          {canEdit && (
            <div className="office-forms">
              {o.active && people.length > 0 && (
                <details>
                  <summary className="small" style={{ cursor: 'pointer' }}>Choose people</summary>
                  <form action={setOfficePeople.bind(null, o.id)} style={{ marginTop: 8 }}>
                    <div className="office-people">
                      {people.map(p => (
                        <label key={p.userId} className="check">
                          <input type="checkbox" name="userId" value={p.userId} defaultChecked={o.people.some(x => x.userId === p.userId)} />
                          {p.name} <span className="muted small">{ROLE[p.role] ?? p.role}</span>
                        </label>
                      ))}
                    </div>
                    <button className="btn small">Save people</button>
                  </form>
                </details>
              )}
              <details>
                <summary className="small" style={{ cursor: 'pointer' }}>Rename or switch off</summary>
                <form action={updateOffice.bind(null, o.id)} className="form-row" style={{ marginTop: 8 }}>
                  <label>Name<input name="name" required maxLength={120} defaultValue={o.name} /></label>
                  <StateField country={country} value={o.state} />
                  <button className="btn small">Save</button>
                </form>
                <form action={setOfficeActive.bind(null, o.id, !o.active)} style={{ marginTop: 8 }}>
                  <button className="btn small secondary">{o.active ? 'Switch off' : 'Switch on'}</button>
                </form>
              </details>
            </div>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="card">
          <h2>Add an office</h2>
          <form action={addOffice} className="form-row">
            <label>Name<input name="name" required maxLength={120} placeholder="e.g. VIC Melbourne Metro" /></label>
            <StateField country={country} />
            <button className="btn">Add office</button>
          </form>
        </div>
      )}

      {live.length > 0 && activeSites.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>{tw.many(T.site)} and their offices</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            {without > 0 ? `${without} of ${activeSites.length} ${sitesWord} have no office yet; their ${tw.lower(T.shift, true)} show under “No office”.`
              : `Every ${site} has an office.`}
          </p>
          <table>
            <thead><tr><th>{tw.one(T.site)}</th><th>{tw.one(T.client)}</th><th>State</th><th>Office</th></tr></thead>
            <tbody>
              {activeSites.map(s => (
                <tr key={s.id}>
                  <td><Link href={`/facilities/${s.id}`}>{s.name}</Link></td>
                  <td>{s.clientName ?? <span className="muted">–</span>}</td>
                  <td>{s.state ?? <span className="muted">–</span>}</td>
                  <td>
                    {canEdit ? (
                      <form action={setSiteOffice.bind(null, s.id)} style={{ display: 'flex', gap: 6 }}>
                        <select name="officeId" defaultValue={s.officeId ?? ''} aria-label={`Office for ${s.name}`}>
                          <option value="">No office</option>
                          {live.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                          {s.officeId && !live.some(o => o.id === s.officeId) && <option value={s.officeId}>{offices.find(o => o.id === s.officeId)?.name ?? 'Switched-off office'}</option>}
                        </select>
                        <button className="btn small secondary">Save</button>
                      </form>
                    ) : offices.find(o => o.id === s.officeId)?.name ?? <span className="muted">No office</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
