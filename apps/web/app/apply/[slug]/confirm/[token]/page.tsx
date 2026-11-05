import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LegalFooter } from '../../../../../lib/legal/legal-footer';
import { confirmApplication, confirmView } from '../../../../../lib/apply';

export const dynamic = 'force-dynamic';
// The link is the applicant's key: keep it out of search engines and other sites' logs.
export const metadata: Metadata = { title: 'Confirm your application · CROP', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Confirming an application (applying online, 5 Nov). Opening the page changes nothing (mail scanners open links);
 * the button confirms, and only then does the business see the application.
 */
export default async function ConfirmApplicationPage({ params, searchParams }: {
  params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { slug, token } = await params;
  const { error } = await searchParams;
  const back = `/apply/${encodeURIComponent(slug)}/confirm/${encodeURIComponent(token)}`;

  async function confirm() {
    'use server';
    const r = await confirmApplication(token);
    redirect(r.ok ? back : `${back}?error=${encodeURIComponent(r.message)}`);
  }

  const r = await confirmView(token);
  return (
    <main className="offer-page">
      <p className="offer-brand">CROP</p>
      <section className="card">
        {!r.ok ? (<><h1>Confirm your application</h1><p>{r.message}</p></>) : (<>
          <p className="muted" style={{ margin: 0 }}>{r.view.business}</p>
          <h1 style={{ marginTop: 4 }}>Hi {r.view.firstName}</h1>
          {error && <p className="notice error" role="alert">{error}</p>}
          {r.view.state === 'confirmed' && <p className="notice success" role="status">Your application is confirmed. {r.view.business} has it now and will be in touch.</p>}
          {r.view.state === 'expired' && <p>This link has run out. Please <a href={`/apply/${encodeURIComponent(slug)}`}>fill in the application form</a> again.</p>}
          {r.view.state === 'ok' && (
            <form action={confirm}>
              <p>Please confirm this is your application to {r.view.business}. They’ll see it straight away.</p>
              <button className="btn primary" type="submit">Confirm my application</button>
            </form>
          )}
        </>)}
      </section>
      <LegalFooter />
    </main>
  );
}
