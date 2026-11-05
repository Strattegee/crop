import type { Metadata } from 'next';
import { LegalFooter } from '../../../lib/legal/legal-footer';
import { applyPage } from '../../../lib/apply';
import { ApplyForm } from './apply-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Apply · CROP', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Public application form (David approved 5 Nov 2026): someone applies to work with a business without signing in.
 * Only for businesses that opened it in Settings › Application form; the application reaches the office once the
 * applicant has confirmed their email.
 */
export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await applyPage(slug);
  if (!r.ok) {
    return (
      <main className="offer-page">
        <p className="offer-brand">CROP</p>
        <section className="card"><h1>Apply</h1><p>{r.message}</p></section>
        <LegalFooter />
      </main>
    );
  }
  const v = r.view;
  return (
    <main className="offer-page request-page">
      <p className="offer-brand">CROP</p>
      <section className="card">
        <p className="muted" style={{ margin: 0 }}>{v.business}</p>
        <h1 style={{ marginTop: 4 }}>Apply to work with us</h1>
        {v.intro && <p style={{ whiteSpace: 'pre-line' }}>{v.intro}</p>}
        <p className="muted">It takes about five minutes. We’ll email you a link to confirm your application before {v.business} sees it.</p>
        <ApplyForm view={v} />
      </section>
      <LegalFooter />
    </main>
  );
}
