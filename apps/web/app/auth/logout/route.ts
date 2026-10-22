import { NextResponse } from 'next/server';
import * as client from 'openid-client';
import { authConfig } from '../../../lib/config';
import { oidc } from '../../../lib/oidc';
import { SESSION_COOKIE } from '../../../lib/session';

export const dynamic = 'force-dynamic';

// POST only, so a link or image on another site can't sign people out.
export async function POST() {
  const cfg = authConfig();
  let target = `${cfg.appUrl}/`;
  if (cfg.enabled) {
    try {
      target = client.buildEndSessionUrl(await oidc(), { client_id: cfg.clientId, post_logout_redirect_uri: `${cfg.appUrl}/` }).href;
    } catch {
      // Provider unreachable: still clear our session.
    }
  }
  const res = NextResponse.redirect(target, { status: 303 });
  res.cookies.delete({ name: SESSION_COOKIE, path: '/' });
  return res;
}
