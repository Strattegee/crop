import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';

export const SESSION_COOKIE = 'crop_session';
export const LOGIN_COOKIE = 'crop_login';

export interface Session {
  accessToken: string;
  /** Unix seconds when the access token expires. */
  expiresAt: number;
}

export interface LoginState {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

const key = (secret: string) => createHash('sha256').update(secret).digest();

/** Encrypts a value for an httpOnly cookie (AES-256-GCM); the browser can't read or alter it. */
export async function seal(value: object, secret: string, maxAgeSeconds: number): Promise<string> {
  return new EncryptJWT({ v: value })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .encrypt(key(secret));
}

export async function unseal<T>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtDecrypt(token, key(secret));
    return payload.v as T;
  } catch {
    return null;
  }
}

/** Only allow returning to paths on this site, never another domain. */
export function safeReturnTo(value: string | null | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}
