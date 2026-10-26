import { cookies } from 'next/headers';
import { cache } from 'react';
import { apiBaseUrl, authConfig } from './config';
import { SESSION_COOKIE, unseal, type Session } from './session';

export interface Me {
  id: string;
  email: string;
  name: string | null;
  memberships: { tenantSlug: string; tenantName: string; role: string }[];
  /** Strattegee staff who can see the Platform screen. */
  platformAdmin?: boolean;
}

export type CurrentUser =
  | { status: 'disabled' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'signed-in'; me: Me; accessToken: string };

/** Reads the session cookie and asks the API who the person is (once per request). */
export const currentUser = cache(async (): Promise<CurrentUser> => {
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
});

export const OFFICE_ROLES = ['owner', 'admin', 'allocator'];
export const AGENCY_COOKIE = 'crop_agency';

/**
 * The agency the office app works in: the one picked in the switcher if the person has an
 * office role there, otherwise their first agency with an office role. Null if they have none.
 */
export const currentAgency = cache(async () => {
  const user = await currentUser();
  if (user.status !== 'signed-in') return null;
  const office = user.me.memberships.filter(m => OFFICE_ROLES.includes(m.role));
  const chosen = (await cookies()).get(AGENCY_COOKIE)?.value;
  return office.find(m => m.tenantSlug === chosen) ?? office[0] ?? null;
});
