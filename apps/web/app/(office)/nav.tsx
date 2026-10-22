'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/facilities', label: 'Facilities' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav style={{ display: 'contents' }}>
      {LINKS.map(l => (
        <Link key={l.href} href={l.href} aria-current={path.startsWith(l.href) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
