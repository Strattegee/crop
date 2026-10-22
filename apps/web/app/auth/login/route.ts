import { NextResponse, type NextRequest } from 'next/server';
import * as client from 'openid-client';
import { authConfig } from '../../../lib/config';
import { oidc, scopes } from '../../../lib/oidc';
import { LOGIN_COOKIE, safeReturnTo, seal, type LoginState } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cfg = authConfig();
  if (!cfg.enabled) return new NextResponse('Sign-in is not configured.', { status: 503 });
  const login: LoginState = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier: client.randomPKCECodeVerifier(),
    returnTo: safeReturnTo(req.nextUrl.searchParams.get('returnTo')),
  };
  const url = client.buildAuthorizationUrl(await oidc(), {
    redirect_uri: cfg.redirectUri,
    scope: scopes(cfg.projectId),
    code_challenge: await client.calculatePKCECodeChallenge(login.codeVerifier),
    code_challenge_method: 'S256',
    state: login.state,
    nonce: login.nonce,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(LOGIN_COOKIE, await seal(login, cfg.sessionSecret, 600), {
    httpOnly: true, secure: cfg.appUrl.startsWith('https://'), sameSite: 'lax', path: '/auth', maxAge: 600,
  });
  return res;
}
