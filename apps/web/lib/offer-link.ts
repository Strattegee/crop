import { apiBaseUrl } from './config';

/** What the person sees on their offer link (no sign-in). */
export type OfferView = {
  business: string;
  firstName: string;
  status: 'pending' | 'expired' | 'accepted' | 'declined' | 'withdrawn' | 'filled';
  expiresAt: string | null;
  /** The business's word for a shift, e.g. { one: 'Job', lower: 'job' }; older APIs may not send it. */
  word?: { one: string; lower: string };
  /** Agency offers: the employer the agency's person would work for. */
  employer?: string;
  shift: { label: string; role: string; date: string; start: string; end: string; site: string; area: string | null; timezone: string; cancelled: boolean };
};

export type OfferResult = { ok: true; view: OfferView } | { ok: false; status: number; message: string };

/** Whose offer: an employer's to its own staff (`/offer/…`) or an agency's to its people (`/agency-offer/…`). */
export type OfferKind = 'staff' | 'agency';
export const OFFER_PATHS: Record<OfferKind, { page: string; api: string }> = {
  staff: { page: '/offer', api: '/offer-links' },
  agency: { page: '/agency-offer', api: '/agency-offer-links' },
};

/** Calls the public offer-link API. The token is the only credential; no cookies or tokens are sent. */
export async function offerLink(token: string, action?: 'accept' | 'decline', kind: OfferKind = 'staff'): Promise<OfferResult> {
  const path = `${OFFER_PATHS[kind].api}/${encodeURIComponent(token)}${action ? `/${action}` : ''}`;
  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, { method: action ? 'POST' : 'GET', cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as OfferView & { message?: string | string[] };
    if (res.ok) return { ok: true, view: body };
    const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    return { ok: false, status: res.status, message: message ?? 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, status: 503, message: "CROP can't be reached right now. Please try again in a minute." };
  }
}
