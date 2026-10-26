import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '../../../../lib/api';
import { currentUser } from '../../../../lib/current-user';
import { Notices } from '../../notices';
import { changeRole, givePerson, removePerson } from '../actions';

export const dynamic = 'force-dynamic';

type Person = { status: 'active' | 'invited'; email: string; name: string | null; role: string; since: string; lastSeen: string | null };
type Detail = { id: string; slug: string; name: string; people: Person[] };
const ROLES: [string, string][] = [
  ['owner', 'Owner: everything, including settings'], ['admin', 'Admin: everything, including settings'],
  ['allocator', 'Allocator: rosters and staff'], ['worker', 'Worker: their own shifts (worker app)'], ['client', 'Client: client portal'],
];
const when = (d: string | null) => d ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' }).format(new Date(d)) : '—';

export default async function PlatformBusinessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const user = await currentUser();
  if (user.status !== 'signed-in' || !user.me.platformAdmin) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const b = await api<Detail>(`/platform/businesses/${id}`);
  return (
    <>
      <p style={{ margin: 0 }}><Link href="/platform">← All businesses</Link></p>
      <h1>{b.name}</h1>
      <p className="muted">Short code <strong>{b.slug}</strong>. People here can sign in to this business; someone can belong to several.</p>
      <Notices error={sp.error} done={sp.done} />
      <div className="card">
        <h2>Give someone access</h2>
        <form action={givePerson.bind(null, b.id)} className="form-row">
          <label>Email<input name="email" type="email" required maxLength={200} /></label>
          <label>Role
            <select name="role" defaultValue="allocator">{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <button type="submit" className="btn">Give access</button>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>They get a welcome email with the sign-in link. If they already use CROP with a verified email, access starts straight away; otherwise at their first sign-in with that email.</p>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <h2>People ({b.people.length})</h2>
        {b.people.length === 0 ? <p className="muted">Nobody yet.</p> : (
          <table>
            <thead><tr><th>Person</th><th>Status</th><th>Role</th><th>Last signed in</th><th /></tr></thead>
            <tbody>
              {b.people.map(p => (
                <tr key={`${p.status}-${p.email}`}>
                  <td><strong>{p.name ?? p.email}</strong>{p.name && <div className="muted small">{p.email}</div>}</td>
                  <td>{p.status === 'active' ? <span className="badge ok">Active</span> : <span className="badge warn">Invited</span>}</td>
                  <td>
                    <form action={changeRole.bind(null, b.id, p.email)} style={{ display: 'flex', gap: 6, margin: 0 }}>
                      <select name="role" defaultValue={p.role} aria-label={`Role for ${p.email}`}>{ROLES.map(([v]) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</select>
                      <button className="btn small secondary">Change</button>
                    </form>
                  </td>
                  <td>{when(p.lastSeen)}</td>
                  <td>
                    <details>
                      <summary className="muted" style={{ cursor: 'pointer' }}>Remove</summary>
                      <form action={removePerson.bind(null, b.id, p.email)} style={{ marginTop: 6 }}>
                        <p className="small" style={{ margin: '0 0 6px' }}>Take away {p.email}&apos;s access to {b.name}? Their account and records stay.</p>
                        <button className="btn small secondary">Yes, remove access</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
