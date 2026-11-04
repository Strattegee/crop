import type { Metadata } from 'next';
import { LegalFooter } from '../../../lib/legal/legal-footer';
import { requestPage } from '../../../lib/customer-request';
import { RequestForm } from './request-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Request staff · CROP', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Public "request staff" page (David, 3 Nov, answer 4): a new or occasional customer tells the business what they
 * need without signing in. Only for businesses that switched it on; nothing is booked until the office accepts it.
 */
export default async function RequestStaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await requestPage(slug);
  if (!r.ok) {
    return (
      <main className="offer-page">
        <p className="offer-brand">CROP</p>
        <section className="card"><h1>Request staff</h1><p>{r.message}</p></section>
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
        <h1 style={{ marginTop: 4 }}>Request staff</h1>
        {v.intro && <p>{v.intro}</p>}
        <p className="muted">Tell us who you need and when. {v.business} will be in touch to confirm: nothing is booked until they do.</p>
        <RequestForm slug={slug} country={v.country} today={v.today} business={v.business} />
      </section>
      <LegalFooter />
    </main>
  );
}
