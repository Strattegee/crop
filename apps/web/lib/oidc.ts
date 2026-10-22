import * as client from 'openid-client';
import { authConfig } from './config';

let cached: Promise<client.Configuration> | undefined;

/** Zitadel discovery, cached. CROP web is a public client using PKCE (no client secret). */
export function oidc(): Promise<client.Configuration> {
  const cfg = authConfig();
  cached ??= client
    .discovery(new URL(cfg.issuer), cfg.clientId, undefined, client.None(), {
      // Only for local tests against a fake http:// provider; Zitadel is always https.
      execute: cfg.issuer.startsWith('http://127.0.0.1') ? [client.allowInsecureRequests] : [],
    })
    .catch(err => {
      cached = undefined;
      throw err;
    });
  return cached;
}

export function scopes(projectId: string): string {
  // The last scope puts the CROP project ID in the access token's audience, which the API checks.
  return `openid profile email urn:zitadel:iam:org:project:id:${projectId}:aud`;
}
