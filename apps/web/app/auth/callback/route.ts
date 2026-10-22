import { NextResponse, type NextRequest } from 'next/server';
import * as client from 'openid-client';
import { authConfig } from '../../../lib/config';
import { oidc } from '../../../lib/oidc';
import { LOGIN_COOKIE, SESSION_COOKIE, seal, unseal, type LoginState, type Session } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cfg = authConfig();
  if (!cfg.enabled) return new NextResponse('Sign-in is not configured.', { status: 503 });
  const login = await unseal<LoginState>(req.cookies.get(LOGIN_COOKIE)?.value, cfg.sessionSecret);
  if (!login) return NextResponse.redirect(`${cfg.appUrl}/?signin=expired`);

  // Behind Caddy the request URL is internal, so rebuild it on the public address.
  const currentUrl = new URL(`${cfg.redirectUri}${req.nextUrl.search}`);
  let tokens;
  try {
    tokens = await client.authorizationCodeGrant(await oidc(), currentUrl, {
      pkceCodeVerifier: login.codeVerifier,
      expectedState: login.state,
      expectedNonce: login.nonce,
      idTokenExpected: true,
    });
  } catch (err) {
    console.error('sign-in callback failed:', err instanceof Error ? err.message : err);
    return NextResponse.redirect(`${cfg.appUrl}/?signin=failed`);
  }

  const expiresIn = tokens.expiresIn() ?? 3600;
  const session: Session = { accessToken: tokens.access_token, expiresAt: Math.floor(Date.now() / 1000) + expiresIn };
  const secure = cfg.appUrl.startsWith('https://');
  const res = NextResponse.redirect(`${cfg.appUrl}${login.returnTo}`);
  res.cookies.set(SESSION_COOKIE, await seal(session, cfg.sessionSecret, expiresIn), {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: expiresIn,
  });
  res.cookies.delete({ name: LOGIN_COOKIE, path: '/auth' });
  return res;
}
