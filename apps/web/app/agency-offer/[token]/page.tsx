import type { Metadata } from 'next';
import { OfferScreen } from '../../offer/offer-screen';

export const dynamic = 'force-dynamic';
// The link is the person's key to this offer: keep it out of search engines and other sites' logs.
export const metadata: Metadata = { title: 'Shift offer · CROP', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** An agency's offer to one of its own people for a shift an employer sent it (backlog item 8, migration 0044). */
export default async function AgencyOfferPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const { done, error } = await searchParams;
  return <OfferScreen token={token} kind="agency" done={done} error={error} />;
}
