import { cookies } from 'next/headers';
import { apiBaseUrl, authConfig } from './config';
import { SESSION_COOKIE, unseal, type Session } from './session';

export interface Me {
  id: string;
  email: string;
  name: string | null;
  memberships: { tenantSlug: string; tenantName: string; role: string }[];
}

export type CurrentUser =
  | { status: 'disabled' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'signed-in'; me: Me; accessToken: string };

/** Reads the session cookie and asks the API who the person is. */
export async function currentUser(): Promise<CurrentUser> {
  const cfg = authConfig();
  if (!cfg.enabled) return { status: 'disabled' };
  const session = await unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value, cfg.sessionSecret);
  if (!session || session.expiresAt <= Date.now() / 1000 + 30) return { status: 'signed-out' };
  try {
    const res = await fetch(`${apiBaseUrl()}/me`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
    });
    if (res.status === 401) return { status: 'signed-out' };
    if (!res.ok) return { status: 'error', message: `API returned ${res.status}` };
    return { status: 'signed-in', me: (await res.json()) as Me, accessToken: session.accessToken };
  } catch {
    return { status: 'error', message: 'API unreachable' };
  }
}
