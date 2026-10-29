import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';
import { authConfig } from '../../../lib/config';
import { AGENCY_COOKIE, currentAgency, currentUser, OFFICE_ROLES } from '../../../lib/current-user';
import { LegalFooter } from '../../../lib/legal/legal-footer';

export const dynamic = 'force-dynamic';
// The link is a one-off key: keep it out of search engines and other sites' logs.
export const metadata: Metadata = { title: 'Agency invitation · CROP', robots: { index: false, follow: false }, referrer: 'no-referrer' };

type Preview = { employerName: string; state: 'pending' | 'used' | 'cancelled' | 'expired'; ownBusiness: boolean; alreadyLinked: boolean; business: string };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Agency invitation link (backlog item 7, David 29 Oct): an employer sent this to an agency. The agency's owner or
 * admin opens it while signed in to CROP, in the agency's business, and confirms. Opening it changes nothing.
 */
export default async function AgencyInvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const here = `/agency-invite/${encodeURIComponent(token)}`;
  const user = await currentUser();

  const shell = (body: React.ReactNode) => (
    <main className="offer-page">
      <p className="offer-brand">CROP</p>
      <section className="card">{body}</section>
      <LegalFooter />
    </main>
  );

  if (!TOKEN.test(token)) return shell(<><h1>Agency invitation</h1><p>This link isn’t valid. Check you’ve used the whole link.</p></>);
  if (user.status !== 'signed-in') {
    return shell(<>
      <h1>Agency invitation</h1>
      <p>A business that uses CROP has invited your agency to link with it, so it can send you shifts it can’t fill.</p>
      <p>Sign in to CROP as an owner or administrator of your agency to see who it’s from and confirm.</p>
      <a className="btn" href={`/auth/login?returnTo=${encodeURIComponent(here)}`}>Sign in</a>
    </>);
  }
  const agency = await currentAgency();
  if (!agency) return shell(<><h1>Agency invitation</h1><p>Your CROP account isn’t an owner or administrator of a business yet, so you can’t confirm this. Ask your agency’s owner to open the link.</p></>);

  let view: Preview;
  try {
    view = await api<Preview>(`/agency-invites/${encodeURIComponent(token)}`);
  } catch (err) {
    return shell(<><h1>Agency invitation</h1><p>{err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'}</p></>);
  }
  const office = user.me.memberships.filter(m => OFFICE_ROLES.includes(m.role));
  const canConfirm = agency.role === 'owner' || agency.role === 'admin';

  async function confirm() {
    'use server';
    try {
      await api(`/agency-invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
    } catch (err) {
      if (err && typeof err === 'object' && 'digest' in err) throw err;
      redirect(`${here}?error=${encodeURIComponent(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')}`);
    }
    redirect(`/settings/agencies?done=${encodeURIComponent(`Linked with ${view.employerName}. Next, match their requirements to your credentials.`)}`);
  }

  async function switchBusiness(f: FormData) {
    'use server';
    const slug = String(f.get('agency') ?? '');
    if (/^[a-z0-9-]{2,40}$/.test(slug)) {
      (await cookies()).set(AGENCY_COOKIE, slug, {
        httpOnly: true, secure: authConfig().appUrl.startsWith('https://'), sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
      });
    }
    redirect(here);
  }

  const closed = view.state === 'used' ? 'This link has already been used.'
    : view.state === 'cancelled' ? `${view.employerName} cancelled this link. Ask them for a new one.`
    : view.state === 'expired' ? `This link has expired. Ask ${view.employerName} for a new one.` : null;

  return shell(<>
    <p className="muted" style={{ margin: 0 }}>Agency invitation</p>
    <h1>{view.employerName} would like to link with {view.business} as an agency</h1>
    <p>Once linked, {view.employerName} can send {view.business} shifts it can’t fill. First you’ll match each of their credential requirements to
      your own, so CROP can tell which of your people meet them. {view.employerName} sees only the name and role of anyone you put forward, never your
      other records. Either business can end the link at any time.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {office.length > 1 && (
      <form action={switchBusiness} style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 12 }}>
        <label>Confirm for
          <select name="agency" defaultValue={agency.tenantSlug}>
            {office.map(m => <option key={m.tenantSlug} value={m.tenantSlug}>{m.tenantName}</option>)}
          </select>
        </label>
        <button className="btn small secondary" type="submit">Switch</button>
      </form>
    )}
    {closed ? <p>{closed}</p>
      : view.ownBusiness ? <p>This link is from {view.business} itself. Open it while signed in to the agency’s business{office.length > 1 ? ' (choose it above)' : ''}.</p>
      : view.alreadyLinked ? <p>{view.business} is already linked with {view.employerName}. <Link href="/settings/agencies">See your links</Link>.</p>
      : !canConfirm ? <p>Only an owner or administrator of {view.business} can confirm this. Ask one of them to open the link.</p>
      : <form action={confirm}><button className="btn" type="submit">Link {view.business} with {view.employerName}</button></form>}
  </>);
}
