'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav({ links }: { links: { href: string; label: string; code: number }[] }) {
  const path = usePathname();
  return (
    <nav style={{ display: 'contents' }}>
      {links.map(l => (
        <Link key={l.href} href={l.href} data-fn={l.code} aria-current={path.startsWith(l.href) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
