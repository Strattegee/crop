import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiBaseUrl, authConfig } from './config';
import { currentAgency } from './current-user';
import { SESSION_COOKIE, unseal, type Session } from './session';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Calls the CROP API as the signed-in person, in the agency chosen in the agency switcher.
 * Signed out or expired: sends them to sign in.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const jar = await cookies();
  const session = await unseal<Session>(jar.get(SESSION_COOKIE)?.value, authConfig().sessionSecret);
  if (!session || session.expiresAt <= Date.now() / 1000 + 30) redirect('/auth/login');
  const headers: Record<string, string> = { authorization: `Bearer ${session.accessToken}` };
  const agency = await currentAgency();
  if (agency) headers['x-tenant'] = agency.tenantSlug;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/auth/login');
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
