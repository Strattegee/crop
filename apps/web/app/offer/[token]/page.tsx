import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { offerLink, type OfferView } from '../../../lib/offer-link';

export const dynamic = 'force-dynamic';
// The link is the person's key to this offer: keep it out of search engines and other sites' logs.
export const metadata: Metadata = { title: 'Shift offer · CROP', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const DONE: Record<string, string> = {
  accepted: "You're booked. We've sent you a confirmation.",
  declined: "Thanks for letting us know. You've said no to this shift.",
};

function untilLabel(v: OfferView) {
  if (!v.expiresAt) return null;
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: v.shift.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(v.expiresAt));
}

function longDate(date: string) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T00:00:00Z`));
}

function closedText(v: OfferView) {
  switch (v.status) {
    case 'accepted': return "You're booked for this shift.";
    case 'declined': return "You've said no to this shift.";
    case 'expired': return `This offer has expired. Contact ${v.business} if you'd still like the shift.`;
    case 'filled': return 'This shift has been filled. Thanks for your time.';
    default: return v.shift.cancelled ? 'This shift has been cancelled.' : 'This offer has been withdrawn.';
  }
}

/**
 * Offer link page (backlog item 6): the person accepts or declines a shift offer without signing in.
 * Opening the page changes nothing; the buttons post. Shows the shift and the person's first name only.
 */
export default async function OfferPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { token } = await params;
  const { done, error } = await searchParams;
  const r = await offerLink(token);

  async function reply(formData: FormData) {
    'use server';
    const action = formData.get('reply') === 'accept' ? 'accept' : 'decline';
    const res = await offerLink(token, action);
    const back = `/offer/${encodeURIComponent(token)}`;
    redirect(res.ok ? `${back}?done=${action === 'accept' ? 'accepted' : 'declined'}` : `${back}?error=${encodeURIComponent(res.message)}`);
  }

  return (
    <main className="offer-page">
      <p className="offer-brand">CROP</p>
      {!r.ok ? (
        <section className="card">
          <h1>Shift offer</h1>
          <p>{r.message}</p>
        </section>
      ) : (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>{r.view.business}</p>
          <h1>Hi {r.view.firstName}, {r.view.status === 'pending' ? 'would you like this shift?' : 'about this shift'}</h1>
          <dl className="offer-shift">
            <dt>Date</dt><dd>{longDate(r.view.shift.date)}</dd>
            <dt>Time</dt><dd>{r.view.shift.start}–{r.view.shift.end}</dd>
            <dt>Role</dt><dd>{r.view.shift.role}</dd>
            <dt>Where</dt><dd>{r.view.shift.site}{r.view.shift.area ? ` (${r.view.shift.area})` : ''}</dd>
          </dl>
          {done && DONE[done] && <p className="notice success" role="status">{DONE[done]}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
          {r.view.status === 'pending' ? (
            <>
              <p className="muted small">
                The first person to accept is booked.{untilLabel(r.view) ? ` This offer is open until ${untilLabel(r.view)}.` : ''}
              </p>
              <form action={reply} className="offer-actions">
                <button className="btn" type="submit" name="reply" value="accept">Accept shift</button>
                <button className="btn secondary" type="submit" name="reply" value="decline">No thanks</button>
              </form>
            </>
          ) : (
            !done && <p>{closedText(r.view)}</p>
          )}
        </section>
      )}
      <p className="muted small">This link is just for you. Please don&apos;t forward it.</p>
    </main>
  );
}
