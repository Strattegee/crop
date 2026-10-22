/** Server-side settings. Non-secret values are set in deploy/staging/compose.yml; SESSION_SECRET in /srv/crop/.env. */
export function authConfig() {
  const issuer = process.env.AUTH_ISSUER?.replace(/\/$/, '') ?? '';
  const clientId = process.env.AUTH_CLIENT_ID ?? '';
  const projectId = process.env.AUTH_PROJECT_ID ?? '';
  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const sessionSecret = process.env.SESSION_SECRET ?? '';
  return {
    issuer,
    clientId,
    projectId,
    appUrl,
    sessionSecret,
    redirectUri: `${appUrl}/auth/callback`,
    enabled: Boolean(issuer && clientId && projectId && sessionSecret.length >= 32),
  };
}

export const apiBaseUrl = () => process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
