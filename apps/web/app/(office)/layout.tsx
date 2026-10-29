import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { currentAgency, currentUser, OFFICE_ROLES } from '../../lib/current-user';
import { TopNav, UserMenu, type NavItem, type NavLink } from './nav';
import { FUNCTIONS } from '../../lib/functions';
import { T, words } from '../../lib/terms';

/** Which screens share a menu across the top (function codes from lib/functions.ts). */
const GROUPS: { codes: number[]; label?: (w: Awaited<ReturnType<typeof words>>) => string }[] = [
  { codes: [1000] },
  { codes: [2000] },
  { codes: [3000, 3200, 3500], label: w => w.many(T.worker) },
  { codes: [4000, 4100], label: w => `${w.many(T.client)} & ${w.lower(T.site, true)}` },
  { codes: [5000, 5500], label: w => `${w.one(T.equipment)} & ${w.lower(T.item, true)}` },
  { codes: [6000] },
];

const initialsOf = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';

/** Everything under (office) needs a signed-in office user (owner, admin or allocator) in the chosen agency. */
export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (user.status !== 'signed-in') redirect('/');
  const current = await currentAgency();
  if (!current) redirect('/');
  const memberships = user.me.memberships.filter(m => OFFICE_ROLES.includes(m.role));
  const w = await words();
  const link = (code: number): NavLink | null => {
    const f = FUNCTIONS.find(x => x.code === code);
    if (!f) return null;
    return { href: f.path, code: f.code, label: 'term' in f ? ('one' in f ? w.one(f.term) : w.many(f.term)) : f.label };
  };
  const items: NavItem[] = GROUPS.map(g => {
    const links = g.codes.map(link).filter((l): l is NavLink => l !== null);
    return { label: g.label ? g.label(w) : links[0]?.label ?? '', links };
  }).filter(i => i.links.length);
  const settings = link(9000)!;
  const platform = user.me.platformAdmin ? link(9900) : null;
  const name = user.me.name ?? user.me.email;

  return (
    <div className="app">
      <header className="appbar">
        <Link href="/dashboard" className="logo">CROP</Link>
        <TopNav items={items} />
        <div className="appbar-right">
          {memberships.length > 1 ? (
            <form action="/agency" method="post" className="business-switch">
              <label className="sr-only" htmlFor="business">Business</label>
              <select id="business" name="agency" defaultValue={current.tenantSlug}>
                {memberships.map(m => <option key={m.tenantSlug} value={m.tenantSlug}>{m.tenantName}</option>)}
              </select>
              <button type="submit" className="btn small">Switch</button>
            </form>
          ) : <span className="business-name">{current.tenantName}</span>}
          <Link href={settings.href} className="appbar-link" data-fn={settings.code} title="Settings">
            <span aria-hidden="true">⚙</span> {settings.label}
          </Link>
          <UserMenu initials={initialsOf(name)}>
            <div className="menu-who"><strong>{name}</strong><span className="muted small">{user.me.email}</span><span className="muted small">{current.tenantName}</span></div>
            {platform && <Link href={platform.href} role="menuitem" data-fn={platform.code}>{platform.label}</Link>}
            <Link href="/legal" role="menuitem">Privacy and legal</Link>
            <form action="/auth/logout" method="post"><button type="submit" role="menuitem" className="menu-button">Sign out</button></form>
          </UserMenu>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
