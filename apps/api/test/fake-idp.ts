import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

export interface FakeUser {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

/** A minimal OIDC provider (discovery, JWKS, userinfo) that signs tokens for tests. */
export async function startFakeIdp(audience: string) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const users = new Map<string, FakeUser>();
  let issuer = '';
  let userinfoCalls = 0;

  const server: Server = createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/.well-known/openid-configuration') {
      return json(200, { issuer, jwks_uri: `${issuer}/keys`, userinfo_endpoint: `${issuer}/userinfo` });
    }
    if (req.url === '/keys') return json(200, { keys: [jwk] });
    if (req.url === '/userinfo') {
      userinfoCalls++;
      const token = (req.headers.authorization ?? '').replace('Bearer ', '');
      const sub = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}').sub;
      const u = users.get(sub);
      return u ? json(200, u) : json(401, { error: 'invalid_token' });
    }
    json(404, {});
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    get userinfoCalls() {
      return userinfoCalls;
    },
    addUser(u: FakeUser) {
      users.set(u.sub, u);
    },
    token(sub: string, opts: { aud?: string; expiresIn?: string; iss?: string } = {}) {
      return new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setSubject(sub)
        .setIssuer(opts.iss ?? issuer)
        .setAudience(opts.aud ?? audience)
        .setIssuedAt()
        .setExpirationTime(opts.expiresIn ?? '5m')
        .sign(privateKey);
    },
    close: () => new Promise<void>(r => server.close(() => r())),
  };
}
