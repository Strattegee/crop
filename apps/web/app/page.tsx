import { redirect } from 'next/navigation';
import { BrandMark } from '../lib/logo';
import { LegalFooter } from '../lib/legal/legal-footer';
import { apiBaseUrl } from '../lib/config';
import { currentUser, OFFICE_ROLES } from '../lib/current-user';

export const dynamic = 'force-dynamic';

type Health = { status: string; db: string; version: string };

async function getHealth(): Promise<Health | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/health`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginTop: 16 } as const;
const button = {
  display: 'inline-block', background: 'var(--orange)', color: 'var(--on-orange)', fontWeight: 600, border: 0, borderRadius: 6,
  padding: '10px 16px', fontSize: 15, cursor: 'pointer', textDecoration: 'none',
} as const;

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', admin: 'Administrator', allocator: 'Allocator', worker: 'Worker', client: 'Client',
};

export default async function Home({ searchParams }: { searchParams: Promise<{ signin?: string }> }) {
  const [health, user, params] = await Promise.all([getHealth(), currentUser(), searchParams]);
  const ok = health?.status === 'ok';
  // Office staff go straight to the office app; others (workers, clients, not yet invited) stay here for now.
  if (user.status === 'signed-in' && user.me.memberships.some(m => OFFICE_ROLES.includes(m.role))) {
    redirect('/dashboard');
  }

  return (
    <main style={{ maxWidth: 640, margin: '64px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}><BrandMark size={40} /><span><span style={{ fontFamily: 'var(--font-brand), system-ui, sans-serif' }}>CROP</span> Workforce Management</span></h1>
      <p style={{ marginTop: 0, color: 'var(--muted)' }}>Credentials · Rostering · Operations · People</p>

      <section style={card}>
        {user.status === 'signed-in' ? (
          <>
            <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Welcome, {user.me.name ?? user.me.email}</h2>
            <p style={{ margin: '0 0 12px', color: 'var(--muted)' }}>{user.me.email}</p>
            {user.me.memberships.length === 0 ? (
              <p>You&apos;re signed in, but you haven&apos;t been given access to a business yet. Ask the business to invite this email address.</p>
            ) : (
              <>
                <ul style={{ paddingLeft: 20 }}>
                  {user.me.memberships.map(m => (
                    <li key={m.tenantSlug}>{m.tenantName}: {ROLE_LABELS[m.role] ?? m.role}</li>
                  ))}
                </ul>
                <p className="muted">Workers will use the CROP app on their phone. Client access is coming soon.</p>
              </>
            )}
            <form action="/auth/logout" method="post">
              <button type="submit" style={{ ...button, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--muted)' }}>Sign out</button>
            </form>
          </>
        ) : user.status === 'disabled' ? (
          <p style={{ margin: 0 }}>Sign-in isn&apos;t configured on this server yet.</p>
        ) : (
          <>
            {params.signin === 'failed' && <p style={{ color: 'var(--bad)' }}>Sign-in didn&apos;t complete. Please try again.</p>}
            {params.signin === 'expired' && <p style={{ color: 'var(--bad)' }}>That sign-in took too long. Please try again.</p>}
            {user.status === 'error' && <p style={{ color: 'var(--bad)' }}>We couldn&apos;t load your account ({user.message}).</p>}
            <a href="/auth/login" style={button}>Sign in</a>
          </>
        )}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>System status</h2>
        <p style={{ margin: 0 }}>
          API: <strong style={{ color: ok ? 'var(--ok)' : 'var(--bad)' }}>{health ? health.status : 'unreachable'}</strong>
          {health && <> · Database: <strong>{health.db}</strong> · Version: {health.version}</>}
        </p>
      </section>
      <LegalFooter />
    </main>
  );
}
