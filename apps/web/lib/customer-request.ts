import { apiBaseUrl } from './config';

/** The public "request staff" page (David, 3 Nov, answer 4): what the business shows, without signing in. */
export type RequestPageView = { business: string; intro: string | null; country: 'AU' | 'NZ' | 'US' | 'GB'; today: string };
export type PageResult = { ok: true; view: RequestPageView } | { ok: false; status: number; message: string };
export type SendResult = { ok: true } | { ok: false; status: number; message: string };

const UNREACHABLE = "CROP can't be reached right now. Please try again in a minute.";

async function call(slug: string, body?: Record<string, string>) {
  const res = await fetch(`${apiBaseUrl()}/request-page/${encodeURIComponent(slug)}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as RequestPageView & { message?: string | string[] };
  const message = Array.isArray(json.message) ? json.message.join('; ') : json.message;
  return { res, json, message };
}

/** Calls the public page API; no cookies or tokens are sent. */
export async function requestPage(slug: string): Promise<PageResult> {
  try {
    const { res, json, message } = await call(slug);
    return res.ok ? { ok: true, view: json } : { ok: false, status: res.status, message: message ?? 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, status: 503, message: UNREACHABLE };
  }
}

export async function sendRequest(slug: string, fields: Record<string, string>): Promise<SendResult> {
  try {
    const { res, message } = await call(slug, fields);
    return res.ok ? { ok: true } : { ok: false, status: res.status, message: message ?? 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, status: 503, message: UNREACHABLE };
  }
}

/** The form's fields, in the order the API reads them ("website" is the field people never see). */
export const REQUEST_FIELDS = [
  'businessName', 'contactName', 'email', 'phone', 'frequency', 'siteName', 'address', 'suburb', 'region', 'postcode',
  'role', 'date', 'startTime', 'endTime', 'people', 'notes', 'website',
] as const;

/** Labels that follow the business's country. */
export function placeLabels(country: string) {
  if (country === 'US') return { region: 'State', postcode: 'ZIP code', suburb: 'City or town' };
  if (country === 'GB') return { region: 'County (optional)', postcode: 'Postcode', suburb: 'Town or city' };
  if (country === 'NZ') return { region: 'Region', postcode: 'Postcode', suburb: 'Suburb or town' };
  return { region: 'State', postcode: 'Postcode', suburb: 'Suburb or town' };
}

/** The page's address as the office would share it: "<app>/request/<slug>". */
export function requestPageUrl(appUrl: string, slug: string) {
  return `${appUrl.replace(/\/$/, '')}/request/${slug}`;
}

/** Status pill words and tone for the office list. */
export function requestStatus(status: string): [string, 'ok' | 'warn' | 'neutral'] {
  if (status === 'accepted') return ['Accepted', 'ok'];
  if (status === 'declined') return ['Declined', 'neutral'];
  return ['New', 'warn'];
}
