// Public settings for the worker app (none are secrets). Override with EXPO_PUBLIC_* in .env for local work;
// for a phone on the same Wi-Fi as a local API, use your computer's LAN address.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://staging.cropwms.com/api';

/** Zitadel (decided 22 Oct 2026). The "CROP Worker App" native client: PKCE, no client secret (David, 29 Oct). */
export const AUTH_ISSUER = process.env.EXPO_PUBLIC_AUTH_ISSUER ?? 'https://crop-wms-g1hp69.au1.zitadel.cloud';
export const AUTH_CLIENT_ID = process.env.EXPO_PUBLIC_AUTH_CLIENT_ID ?? '396209764272477215';
/** The CROP project; asking for it puts the project in the access token's audience, which the API checks. */
export const AUTH_PROJECT_ID = process.env.EXPO_PUBLIC_AUTH_PROJECT_ID ?? '396208029055362428';

/** Registered in Zitadel for the native client. Sign-in needs a development or store build (Expo Go uses exp:// links). */
export const REDIRECT_URI = 'crop://auth/callback';
export const POST_LOGOUT_URI = 'crop://auth/logout';

export const SCOPES = ['openid', 'profile', 'email', 'offline_access', `urn:zitadel:iam:org:project:id:${AUTH_PROJECT_ID}:aud`];
