import { NextResponse, type NextRequest } from 'next/server';
import { authConfig } from '../../lib/config';
import { AGENCY_COOKIE } from '../../lib/current-user';

export const dynamic = 'force-dynamic';

/** Agency switcher: remembers which agency the person is working in. The API still checks it's one of theirs. */
export async function POST(req: NextRequest) {
  const cfg = authConfig();
  const slug = String((await req.formData()).get('agency') ?? '');
  const res = NextResponse.redirect(`${cfg.appUrl}/dashboard`, { status: 303 });
  if (/^[a-z0-9-]{2,40}$/.test(slug)) {
    res.cookies.set(AGENCY_COOKIE, slug, {
      httpOnly: true, secure: cfg.appUrl.startsWith('https://'), sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
