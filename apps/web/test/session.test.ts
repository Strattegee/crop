import { describe, expect, it } from 'vitest';
import { safeReturnTo, seal, unseal } from '../lib/session';

const SECRET = 'x'.repeat(64);

describe('session cookies', () => {
  it('round-trips a sealed value', async () => {
    const sealed = await seal({ accessToken: 'abc', expiresAt: 1 }, SECRET, 60);
    expect(await unseal(sealed, SECRET)).toEqual({ accessToken: 'abc', expiresAt: 1 });
  });

  it('rejects tampering, a different secret and expiry', async () => {
    const sealed = await seal({ a: 1 }, SECRET, 60);
    expect(await unseal(sealed.slice(0, -3) + 'abc', SECRET)).toBeNull();
    expect(await unseal(sealed, 'y'.repeat(64))).toBeNull();
    expect(await unseal(await seal({ a: 1 }, SECRET, -10), SECRET)).toBeNull();
    expect(await unseal(undefined, SECRET)).toBeNull();
  });

  it('only returns to paths on this site', () => {
    expect(safeReturnTo('/roster?week=2')).toBe('/roster?week=2');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });
});
