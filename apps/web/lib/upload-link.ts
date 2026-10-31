import { apiBaseUrl } from './config';

/** What the person sees on their upload link (no sign-in). */
export type UploadView = {
  business: string;
  firstName: string;
  expiresAt: string;
  state: 'ok' | 'expired' | 'stopped';
  word?: { one: string; lower: string };
  items: { credentialTypeId: string; typeName: string; required: boolean; hasNumber: boolean; hasExpiry: boolean; sent: { files: number } | null }[];
  rightToWork: { canSend: boolean; files: number } | null;
};
export type UploadResult = { ok: true; view: UploadView } | { ok: false; status: number; message: string };

/** Calls the public upload-link API. The token is the only credential; no cookies or tokens are sent. */
export async function uploadLink(token: string, send?: { path: 'credentials' | 'right-to-work'; form: FormData }): Promise<UploadResult> {
  const url = `${apiBaseUrl()}/upload-links/${encodeURIComponent(token)}${send ? `/${send.path}` : ''}`;
  try {
    const res = await fetch(url, { method: send ? 'POST' : 'GET', body: send?.form, cache: 'no-store' });
    if (res.status === 413) return { ok: false, status: 413, message: 'That file is too large. The limit is 10 MB.' };
    const body = (await res.json().catch(() => ({}))) as UploadView & { message?: string | string[] };
    if (res.ok) return { ok: true, view: body };
    const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    return { ok: false, status: res.status, message: message ?? 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, status: 503, message: "CROP can't be reached right now. Please try again in a minute." };
  }
}

/** "Sunday 8 November" for when the link stops working. */
export const untilDay = (iso: string) =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
