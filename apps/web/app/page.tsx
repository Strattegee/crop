export const dynamic = 'force-dynamic';

type Health = { status: string; db: string; version: string };

async function getHealth(): Promise<Health | null> {
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${base}/health`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const health = await getHealth();
  const ok = health?.status === 'ok';
  return (
    <main style={{ maxWidth: 640, margin: '64px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>CROP Workforce Management</h1>
      <p style={{ marginTop: 0, color: '#5d6775' }}>Credentials · Rostering · Operations · People</p>
      <section style={{ background: '#fff', border: '1px solid #d6dae1', borderRadius: 8, padding: 16, marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>System status</h2>
        <p style={{ margin: 0 }}>
          API: <strong style={{ color: ok ? '#1a7f37' : '#b42318' }}>{health ? health.status : 'unreachable'}</strong>
          {health && <> · Database: <strong>{health.db}</strong> · Version: {health.version}</>}
        </p>
      </section>
    </main>
  );
}
