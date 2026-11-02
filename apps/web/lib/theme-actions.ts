'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { parseTheme, THEME_COOKIE } from './theme';

/** Saves the person's light/dark choice on this browser for a year and returns them to the page they were on. */
export async function setTheme(form: FormData) {
  const theme = parseTheme(String(form.get('theme') ?? ''));
  (await cookies()).set(THEME_COOKIE, theme, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: false });
  redirect(backPath((await headers()).get('referer')));
}

/** The page the person was on (same site only), so changing the look doesn't move them. */
function backPath(referer: string | null): string {
  try {
    const u = new URL(referer ?? '');
    const path = `${u.pathname}${u.search}`;
    return path.startsWith('/') && !path.startsWith('//') ? path : '/dashboard';
  } catch {
    return '/dashboard';
  }
}
