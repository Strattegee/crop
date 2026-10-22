import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface IdentityProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Verifies access tokens from the identity provider (Zitadel, OIDC) and fetches the
 * user's profile from the userinfo endpoint when we need their email.
 *
 * Config: AUTH_ISSUER (e.g. https://cropwms-xxxx.zitadel.cloud) and AUTH_AUDIENCE (the Zitadel project ID).
 * The Zitadel applications must issue JWT access tokens.
 */
@Injectable()
export class TokenVerifier {
  private readonly issuer = (process.env.AUTH_ISSUER ?? '').replace(/\/$/, '');
  private readonly audience = process.env.AUTH_AUDIENCE ?? '';
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private discovery?: Promise<{ jwks_uri: string; userinfo_endpoint: string }>;

  get configured(): boolean {
    return Boolean(this.issuer && this.audience);
  }

  private meta() {
    this.discovery ??= fetch(`${this.issuer}/.well-known/openid-configuration`).then(async r => {
      if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
      return r.json() as Promise<{ jwks_uri: string; userinfo_endpoint: string }>;
    });
    this.discovery.catch(() => (this.discovery = undefined));
    return this.discovery;
  }

  async verify(token: string): Promise<JWTPayload & { sub: string }> {
    if (!this.configured) throw new UnauthorizedException('sign-in is not configured');
    this.jwks ??= createRemoteJWKSet(new URL((await this.meta()).jwks_uri));
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.issuer, audience: this.audience });
      if (!payload.sub) throw new Error('token has no subject');
      return payload as JWTPayload & { sub: string };
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
  }

  async profile(token: string): Promise<IdentityProfile> {
    const res = await fetch((await this.meta()).userinfo_endpoint, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new UnauthorizedException('could not load profile from identity provider');
    const info = (await res.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string };
    if (!info.email) throw new UnauthorizedException('identity provider did not return an email (request the email scope)');
    return { subject: info.sub, email: info.email, emailVerified: info.email_verified === true, name: info.name ?? null };
  }
}
