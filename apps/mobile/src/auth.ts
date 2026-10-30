import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { AUTH_CLIENT_ID, AUTH_ISSUER, POST_LOGOUT_URI } from './config';

/**
 * Sign-in for the worker app: OIDC authorisation code flow with PKCE against Zitadel (no client secret).
 * Tokens stay on the phone in the system's secure storage (Keychain / Keystore), never in plain storage.
 */
const KEY = 'crop.session';

export interface Session {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
  issuedAt: number;
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export async function saveSession(t: AuthSession.TokenResponse): Promise<Session> {
  const s: Session = { accessToken: t.accessToken, refreshToken: t.refreshToken, idToken: t.idToken, expiresIn: t.expiresIn, issuedAt: t.issuedAt };
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  return s;
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}

/** Exchanges the code from the sign-in page for tokens and keeps them. */
export async function finishSignIn(code: string, codeVerifier: string, redirectUri: string, discovery: AuthSession.DiscoveryDocument) {
  const t = await AuthSession.exchangeCodeAsync({ clientId: AUTH_CLIENT_ID, code, redirectUri, extraParams: { code_verifier: codeVerifier } }, discovery);
  return saveSession(t);
}

/**
 * An access token that is still good for at least a minute, refreshing it if needed.
 * Returns null when the person has to sign in again.
 */
export async function freshToken(): Promise<string | null> {
  const s = await loadSession();
  if (!s) return null;
  const fresh = AuthSession.TokenResponse.isTokenFresh({ expiresIn: s.expiresIn, issuedAt: s.issuedAt }, 60);
  if (fresh) return s.accessToken;
  if (!s.refreshToken) return null;
  try {
    const discovery = await AuthSession.fetchDiscoveryAsync(AUTH_ISSUER);
    const t = await AuthSession.refreshAsync({ clientId: AUTH_CLIENT_ID, refreshToken: s.refreshToken }, discovery);
    // Zitadel may not send a new refresh token every time; keep the old one then.
    if (!t.refreshToken) t.refreshToken = s.refreshToken;
    return (await saveSession(t)).accessToken;
  } catch {
    await clearSession();
    return null;
  }
}

/** Signs out on the phone and ends the identity provider's session, so the next person must sign in. */
export async function signOut() {
  const s = await loadSession();
  await clearSession();
  try {
    const discovery = await AuthSession.fetchDiscoveryAsync(AUTH_ISSUER);
    if (s?.refreshToken && discovery.revocationEndpoint) {
      await AuthSession.revokeAsync({ clientId: AUTH_CLIENT_ID, token: s.refreshToken }, discovery).catch(() => undefined);
    }
    if (discovery.endSessionEndpoint) {
      const q = new URLSearchParams({ client_id: AUTH_CLIENT_ID, post_logout_redirect_uri: POST_LOGOUT_URI });
      if (s?.idToken) q.set('id_token_hint', s.idToken);
      await WebBrowser.openAuthSessionAsync(`${discovery.endSessionEndpoint}?${q}`, POST_LOGOUT_URI);
    }
  } catch {
    // Signed out on the phone either way.
  }
}
