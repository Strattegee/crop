import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '../../../lib/api';
import { currentUser } from '../../../lib/current-user';
import { Notices } from '../notices';
import { addBusiness } from './actions';

export const dynamic = 'force-dynamic';

type Business = { id: string; slug: string; name: string; createdAt: string; people: number; invited: number; owners: number };
const date = (d: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Melbourne' }).format(new Date(d));

/** Strattegee only: every business on CROP, and adding new ones. */
export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const user = await currentUser();
  if (user.status !== 'signed-in' || !user.me.platformAdmin) notFound();
  const [list, sp] = await Promise.all([api<Business[]>('/platform/businesses'), searchParams]);
  return (
    <>
      <h1>Platform</h1>
      <p className="muted">Every business on CROP and who can sign in to each. Only Strattegee platform administrators see this page.</p>
      <Notices error={sp.error} done={sp.done} />
      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add a business</summary>
        <form action={addBusiness} className="form-row" style={{ marginTop: 12 }}>
          <label>Business name<input name="name" required minLength={2} maxLength={80} placeholder="e.g. Bayside Cafe" /></label>
          <label>Owner&apos;s email <span className="muted">(optional)</span><input name="ownerEmail" type="email" maxLength={200} placeholder="owner@their-business.com.au" /></label>
          <button type="submit" className="btn">Add business</button>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>The owner gets access the first time they sign in to CROP with that email address, once it&apos;s verified. No email is sent yet: tell them to go to the CROP sign-in page.</p>
      </details>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Business</th><th>Short code</th><th>People</th><th>Invited</th><th>Added</th></tr></thead>
          <tbody>
            {list.map(b => (
              <tr key={b.id}>
                <td><Link href={`/platform/${b.id}`}>{b.name}</Link>{b.owners === 0 && <span className="badge warn" style={{ marginLeft: 6 }}>No owner yet</span>}</td>
                <td className="muted">{b.slug}</td>
                <td>{b.people}</td>
                <td>{b.invited || '—'}</td>
                <td>{date(b.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
