import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { T, words } from '../../../../lib/terms';
import { Notices } from '../../notices';
import { saveAccess } from './actions';

export const dynamic = 'force-dynamic';

type Site = { id: string; name: string; kind: string; active: boolean };
type Person = { userId: string; name: string; email: string; role: string; facilityIds: string[]; limited: boolean; canChange: boolean; sitesWords: string };

const ROLE: Record<string, string> = { owner: 'Owner', admin: 'Administrator', allocator: 'Allocator', supervisor: 'Supervisor' };

/**
 * Settings › Team access (function 9190; David, 4 Nov 2026): which sites and projects each allocator and supervisor
 * works on. Allocators see every site unless some are ticked; supervisors only ever see the ones ticked, and only what
 * relates to the shifts there. Owners and admins always see everything. CROP enforces it for every screen and in the
 * database, not only in the menus.
 */
export default async function TeamAccessPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const [tw, agency, sp] = await Promise.all([words(), currentAgency(), searchParams]);
  if (agency?.role !== 'owner' && agency?.role !== 'admin') {
    return <><h1>Team access</h1><p className="muted">Only owners and administrators can see and change this.</p></>;
  }
  const { people, sites } = await api<{ people: Person[]; sites: Site[] }>('/site-access');
  const site = tw.lower(T.site), sitesWord = tw.lower(T.site, true);
  const live = sites.filter(s => s.active);
  const kindWord = (s: Site) => (s.kind === 'project' ? tw.one(T.project) : tw.one(T.site));
  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link href="/settings">← Settings</Link></p>
      <h1>Team access</h1>
      <p className="muted">
        Choose the {sitesWord} each person in the office works on. <strong>Allocators</strong> see every {site} unless you tick some.
        {' '}<strong>Supervisors</strong> see only the {sitesWord} you tick: the {tw.lower(T.roster)} there (they can put people on, offer,
        confirm and take people off, but not add, cancel or publish), their people&apos;s {tw.lower(T.role, true)} and {tw.lower(T.credential, true)},
        never contact details, addresses, dates of birth or employment records. Everyone sees the business-wide numbers on the dashboard.
        Owners and administrators always see everything.
      </p>
      <Notices error={sp.error} done={sp.done} />
      {people.length === 0 && <p className="muted">Nobody in the office yet.</p>}
      {people.map(p => {
        const ticked = new Set(p.facilityIds);
        return (
          <div className="card" key={p.userId}>
            <h2 style={{ marginBottom: 4 }}>{p.name} <span className="muted small">{ROLE[p.role] ?? p.role}</span></h2>
            <p className="muted small" style={{ marginTop: 0 }}>{p.email} · {p.sitesWords}</p>
            {p.canChange ? (
              <form action={saveAccess.bind(null, p.userId)}>
                <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                  <legend className="small muted" style={{ padding: 0 }}>Role</legend>
                  <label className="inline"><input type="radio" name="role" value="allocator" defaultChecked={p.role === 'allocator'} /> Allocator</label>
                  <label className="inline"><input type="radio" name="role" value="supervisor" defaultChecked={p.role === 'supervisor'} /> Supervisor</label>
                </fieldset>
                <fieldset style={{ border: 0, padding: 0, margin: '8px 0' }}>
                  <legend className="small muted" style={{ padding: 0 }}>{tw.many(T.site)} they work on {p.role === 'allocator' && <>(none ticked = every {site})</>}</legend>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                    {[...live, ...sites.filter(s => !s.active && ticked.has(s.id))].map(s => (
                      <label key={s.id} className="inline small">
                        <input type="checkbox" name="facilityId" value={s.id} defaultChecked={ticked.has(s.id)} /> {s.name}
                        <span className="muted"> · {kindWord(s)}{s.active ? '' : ', archived'}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button type="submit" className="btn small">Save</button>
              </form>
            ) : <p className="muted small" style={{ margin: 0 }}>Sees every {site}.</p>}
          </div>
        );
      })}
      <p className="muted small">To invite someone new as a supervisor, ask Strattegee (Platform) or use the staging invite with the Supervisor role, then tick their {sitesWord} here.</p>
    </>
  );
}
