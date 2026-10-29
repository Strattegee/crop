'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type NavLink = { href: string; label: string; code: number };
/** A top-menu entry: a single link, or a group that opens a small menu (like People ▾). */
export type NavItem = { label: string; links: NavLink[] };

const isOn = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** Closes an open menu on a click outside it, on Escape, and when the page changes. */
function useMenu() {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(null), [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return { open, setOpen, ref, path };
}

/** The main menu across the top of the office app (David, 29 Oct: a top menu, not a side menu). */
export function TopNav({ items }: { items: NavItem[] }) {
  const { open, setOpen, ref, path } = useMenu();
  return (
    <nav className="topnav" ref={ref} aria-label="Main">
      {items.map(item => {
        if (item.links.length === 1) {
          const l = item.links[0];
          return <Link key={l.href} href={l.href} data-fn={l.code} aria-current={isOn(path, l.href) ? 'page' : undefined}>{item.label}</Link>;
        }
        const current = item.links.some(l => isOn(path, l.href));
        const isOpen = open === item.label;
        return (
          <div key={item.label} className="topnav-group">
            <button type="button" aria-expanded={isOpen} aria-haspopup="true" data-current={current ? 'true' : undefined}
              onClick={() => setOpen(isOpen ? null : item.label)}>
              {item.label} <span className="caret" aria-hidden="true">▾</span>
            </button>
            {isOpen && (
              <div className="topnav-menu" role="menu">
                {item.links.map(l => (
                  <Link key={l.href} href={l.href} role="menuitem" data-fn={l.code} aria-current={isOn(path, l.href) ? 'page' : undefined}>{l.label}</Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** The person's menu at the top right: who they are, Platform (Strattegee staff) and Sign out. */
export function UserMenu({ initials, children }: { initials: string; children: ReactNode }) {
  const { open, setOpen, ref } = useMenu();
  return (
    <div className="topnav-group user-menu" ref={ref as React.RefObject<HTMLDivElement>}>
      <button type="button" className="avatar" aria-expanded={open === 'me'} aria-haspopup="true" aria-label="Your account"
        onClick={() => setOpen(open === 'me' ? null : 'me')}>{initials}</button>
      {open === 'me' && <div className="topnav-menu right" role="menu">{children}</div>}
    </div>
  );
}
