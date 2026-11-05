import Link from 'next/link';
import { api } from '../../../../lib/api';
import { currentAgency } from '../../../../lib/current-user';
import { Badge } from '../../../../lib/format';
import { CLIENT_STATUS } from '../../../../lib/places';
import { PlaceFields } from '../../../../lib/place-fields';
import { Notices } from '../../notices';
import { addContact, addFacility, setContactActive, updateClient, updateContact } from '../actions';
import { T, words } from '../../../../lib/terms';
import { contactLine, rankChip, type ClientContact } from '../../../../lib/client-orders';
import { ClientAllocationFields } from '../client-fields';
import { OfficeField } from '../../settings/offices/office-field';
import { businessNumberKind, showBusinessNumber } from '../../../../lib/business-number';
import { clientProjectsLine, statusBadge, type ProjectStatus } from '../../../../lib/projects';
import { NewProjectForm } from '../../projects/new-project-form';

export const dynamic = 'force-dynamic';

type ProjectRow = { id: string; name: string; code: string | null; status: ProjectStatus; dates: string | null; managerName: string | null; areaCount: number; unfilledNext7: number };
type ClientDetail = {
  id: string; name: string; abn: string | null; status: string; billingContactName: string | null; billingEmail: string | null;
  phone: string | null; notes: string | null; confirmsBookings: boolean; rank: number | null;
  facilities: { id: string; name: string; kind?: string; suburb: string | null; state: string | null; active: boolean; areaCount: number }[];
  contacts?: ClientContact[];
};

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string; newProject?: string }> }) {
  const tw = await words();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [c, agency, settings, offices, projects] = await Promise.all([api<ClientDetail>(`/clients/${id}`), currentAgency(), api<{ country?: string }>('/settings').catch(() => ({ country: 'AU' })),
    api<{ id: string; name: string; active: boolean }[]>('/offices').catch(() => []),
    api<ProjectRow[]>(`/projects?status=all&clientId=${id}`).catch(() => [] as ProjectRow[])]);
  const home = settings.country ?? 'AU';
  const bn = businessNumberKind(home);
  const canEdit = agency?.role === 'owner' || agency?.role === 'admin';
  const contacts = c.contacts ?? [];
  // Projects sit under their client (David, 5 Nov); the Sites card lists the client's ordinary sites.
  const sites = c.facilities.filter(f => f.kind !== 'project');
  const people = canEdit ? await api<{ userId: string; name: string }[]>('/offices/people').catch(() => []) : [];
  const P = tw.many(T.project);
  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link href="/clients">← Clients</Link></p>
      <h1>{c.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}><Badge label={CLIENT_STATUS[c.status]} />{c.abn && <> · {bn.label} {showBusinessNumber(c.abn)}</>}{c.billingEmail && <> · {c.billingEmail}</>}
        {rankChip(c.rank) && <> · <span className="rank-chip">{rankChip(c.rank)}</span></>}{c.confirmsBookings && <> · Confirms each booking</>}</p>
      <Notices error={sp.error} done={sp.done} />

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>{tw.many(T.site)}</h2>
        {sites.length === 0 ? <p className="muted">No {tw.lower(T.site, true)} yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Location</th><th>Areas</th></tr></thead>
            <tbody>
              {sites.map(f => (
                <tr key={f.id} style={{ opacity: f.active ? 1 : 0.5 }}>
                  <td><Link href={`/facilities/${f.id}`}>{f.name}</Link></td>
                  <td>{[f.suburb, f.state].filter(Boolean).join(', ') || '—'}</td>
                  <td>{f.areaCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <details style={{ marginTop: 12 }} open={sites.length === 0 && projects.length === 0}>
            <summary style={{ cursor: 'pointer' }}>Add a facility</summary>
            <form action={addFacility.bind(null, c.id)} className="form-row" style={{ marginTop: 12 }}>
              <label>Name<input name="name" required maxLength={200} placeholder="e.g. Northside Private Hospital" /></label>
              <label>Street address<input name="addressLine" maxLength={200} /></label>
              <PlaceFields homeCountry={home} />
              <OfficeField offices={offices} />
              <label>Phone<input name="phone" maxLength={30} /></label>
              <button type="submit" className="btn">Add facility</button>
            </form>
          </details>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }} id="projects">
        <h2>{P}</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          {clientProjectsLine({ current: projects.filter(p => p.status !== 'archived').length, archived: projects.filter(p => p.status === 'archived').length }, tw.one(T.project), P)}
          {' '}Each has its own {tw.lower(T.area, true)}, team and roster; choose it on the roster to see it on its own.
        </p>
        {projects.length > 0 && (
          <table>
            <thead><tr><th>{tw.one(T.project)}</th><th>Status</th><th>Dates</th><th>Manager</th><th className="num">Unfilled, next 7 days</th></tr></thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.id} style={{ opacity: p.status === 'archived' ? 0.6 : 1 }}>
                  <td><Link href={`/projects/${p.id}`}><strong>{p.name}</strong></Link>{p.code && <span className="muted"> · {p.code}</span>}
                    <div className="muted small">{tw.count(p.areaCount, T.area)}</div></td>
                  <td><Badge label={statusBadge(p.status)} /></td>
                  <td className="small">{p.dates ?? <span className="muted">—</span>}</td>
                  <td className="small">{p.managerName ?? <span className="muted">—</span>}</td>
                  <td className="num">{p.unfilledNext7 > 0 ? <span className="badge warn">{p.unfilledNext7}</span> : <span className="muted">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <details style={{ marginTop: 12 }} open={sp.newProject === '1'}>
            <summary style={{ cursor: 'pointer' }}>+ New {tw.lower(T.project)} for {c.name}</summary>
            <NewProjectForm from="client" clientId={c.id} clients={[{ id: c.id, name: c.name, status: c.status }]} people={people} offices={offices} country={home} />
          </details>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>Contacts</h2>
        <p className="muted small" style={{ marginTop: 0 }}>The people at {c.name} who order {tw.lower(T.shift, true)}. Pick them under Who asked when taking an order; the booked email goes to the email here.</p>
        {contacts.length === 0 ? <p className="muted">No contacts saved yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th></th></tr></thead>
            <tbody>
              {contacts.map(k => (
                <tr key={k.id} style={{ opacity: k.active === false ? 0.5 : 1 }}>
                  <td>{contactLine(k, false)}{k.active === false && <span className="muted"> · switched off</span>}{k.notes && <div className="muted small">{k.notes}</div>}</td>
                  <td>{k.email ?? '–'}</td>
                  <td>{k.phone ?? '–'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <details>
                      <summary style={{ cursor: 'pointer' }}>Edit</summary>
                      <form action={updateContact.bind(null, c.id, k.id)} className="form-row" style={{ marginTop: 8 }}>
                        <label>Name<input name="name" required maxLength={120} defaultValue={k.name} /></label>
                        <label>Position<input name="position" maxLength={120} defaultValue={k.position ?? ''} /></label>
                        <label>Email<input name="email" type="email" maxLength={200} defaultValue={k.email ?? ''} /></label>
                        <label>Phone<input name="phone" maxLength={40} defaultValue={k.phone ?? ''} /></label>
                        <label style={{ flexBasis: '100%' }}>Notes<input name="notes" maxLength={500} defaultValue={k.notes ?? ''} /></label>
                        <button type="submit" className="btn">Save</button>
                      </form>
                      <form action={setContactActive.bind(null, c.id, k.id, k.active === false)} style={{ marginTop: 8 }}>
                        <button type="submit" className="btn secondary">{k.active === false ? 'Switch on' : 'Switch off'}</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <details style={{ marginTop: 12 }} open={contacts.length === 0}>
          <summary style={{ cursor: 'pointer' }}>Add a contact</summary>
          <form action={addContact.bind(null, c.id)} className="form-row" style={{ marginTop: 12 }}>
            <label>Name<input name="name" required maxLength={120} /></label>
            <label>Position <span className="muted">(optional)</span><input name="position" maxLength={120} placeholder="e.g. Nurse unit manager" /></label>
            <label>Email<input name="email" type="email" maxLength={200} /></label>
            <label>Phone<input name="phone" maxLength={40} /></label>
            <label style={{ flexBasis: '100%' }}>Notes <span className="muted">(optional)</span><input name="notes" maxLength={500} /></label>
            <button type="submit" className="btn">Add contact</button>
          </form>
        </details>
      </div>

      {canEdit && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edit client</summary>
          <form action={updateClient.bind(null, c.id)} className="form-row" style={{ marginTop: 12 }}>
            <label>Name<input name="name" required defaultValue={c.name} maxLength={200} /></label>
            <label>{bn.label}<input name="businessNumber" defaultValue={c.abn ?? ''} maxLength={20} placeholder={bn.hint} /></label>
            <label>Status
              <select name="status" defaultValue={c.status}>
                <option value="active">Active</option><option value="on_hold">On hold</option><option value="inactive">Inactive</option>
              </select>
            </label>
            <label>Billing contact<input name="billingContactName" defaultValue={c.billingContactName ?? ''} maxLength={200} /></label>
            <label>Billing email<input name="billingEmail" type="email" defaultValue={c.billingEmail ?? ''} maxLength={200} /></label>
            <label>Phone<input name="phone" defaultValue={c.phone ?? ''} maxLength={30} /></label>
            <ClientAllocationFields client={tw.lower(T.client)} shift={tw.lower(T.shift)} confirmsBookings={c.confirmsBookings} rank={c.rank} />
            <label style={{ flexBasis: '100%' }}>Notes<textarea name="notes" defaultValue={c.notes ?? ''} maxLength={2000} rows={3} /></label>
            <button type="submit" className="btn">Save</button>
          </form>
        </details>
      )}
    </>
  );
}

