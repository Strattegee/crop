import type { Metadata } from 'next';
import { OfferScreen } from '../offer-screen';

export const dynamic = 'force-dynamic';
// The link is the person's key to this offer: keep it out of search engines and other sites' logs.
export const metadata: Metadata = { title: 'Shift offer · CROP', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** An employer's offer to one of its own staff (backlog item 6). */
export default async function OfferPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const { done, error } = await searchParams;
  return <OfferScreen token={token} kind="staff" done={done} error={error} />;
}
