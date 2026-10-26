import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { currentAgency, currentUser, OFFICE_ROLES } from '../../lib/current-user';
import { Nav } from './nav';
import { FUNCTIONS } from '../../lib/functions';
import { words } from '../../lib/terms';

/** Everything under (office) needs a signed-in office user (owner, admin or allocator) in the chosen agency. */
export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (user.status !== 'signed-in') redirect('/');
  const current = await currentAgency();
  if (!current) redirect('/');
  const memberships = user.me.memberships.filter(m => OFFICE_ROLES.includes(m.role));
  const w = await words();
  const links = FUNCTIONS.filter(f => !('subPage' in f) && (!('platformOnly' in f) || user.me.platformAdmin)).map(f => ({ href: f.path, code: f.code, label: 'term' in f ? ('one' in f ? w.one(f.term) : w.many(f.term)) : f.label }));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">CROP</div>
        <Nav links={links} />
        <div className="spacer" />
        <form action="/auth/logout" method="post">
          <button type="submit" className="btn small secondary" style={{ width: '100%' }}>Sign out</button>
        </form>
      </aside>
      <div>
        <header className="topbar">
          <div>
            <strong>{current.tenantName}</strong>
            <span className="muted"> · {user.me.name ?? user.me.email}</span>
          </div>
          {memberships.length > 1 && (
            <form action="/agency" method="post">
              <label style={{ flexDirection: 'row', alignItems: 'center' }}>
                Business
                <select name="agency" defaultValue={current.tenantSlug}>
                  {memberships.map(m => <option key={m.tenantSlug} value={m.tenantSlug}>{m.tenantName}</option>)}
                </select>
              </label>
              <button type="submit" className="btn small secondary">Switch</button>
            </form>
          )}
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
