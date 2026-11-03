import { describe, expect, it } from 'vitest';
import { pushPlatform, Registered, shouldAsk, tapTarget } from '../src/push-rules';

describe('push in the app', () => {
  it('only registers phones', () => {
    expect(pushPlatform('ios')).toBe('ios');
    expect(pushPlatform('android')).toBe('android');
    expect(pushPlatform('web')).toBeNull();
  });

  it('asks for permission only when it can', () => {
    expect(shouldAsk('undetermined', true)).toBe(true);
    expect(shouldAsk('denied', true)).toBe(true);
    expect(shouldAsk('denied', false)).toBe(false);
    expect(shouldAsk('granted', true)).toBe(false);
  });

  it('remembers what to forget at sign-out, once', () => {
    const r = new Registered();
    r.set('cafe', 'ExpoPushToken[a]');
    r.set('other', 'ExpoPushToken[b]');
    expect(r.has('cafe', 'ExpoPushToken[a]')).toBe(true);
    expect(r.has('cafe', 'ExpoPushToken[b]')).toBe(false);
    expect(r.take()).toEqual([['cafe', 'ExpoPushToken[a]'], ['other', 'ExpoPushToken[b]']]);
    expect(r.take()).toEqual([]);
  });
});

describe('tapping a notification', () => {
  const mine = ['cafe', 'kitchen-co'];
  it('opens the business and tab CROP named', () => {
    expect(tapTarget({ ref: 'x', tenant: 'cafe', screen: 'offers' }, mine)).toEqual({ tenant: 'cafe', screen: 'offers' });
    expect(tapTarget({ tenant: 'kitchen-co', screen: 'credentials' }, mine)).toEqual({ tenant: 'kitchen-co', screen: 'credentials' });
  });
  it('opens the business only when the screen is missing or unknown', () => {
    expect(tapTarget({ tenant: 'cafe', screen: null }, mine)).toEqual({ tenant: 'cafe', screen: null });
    expect(tapTarget({ tenant: 'cafe', screen: 'settings' }, mine)).toEqual({ tenant: 'cafe', screen: null });
  });
  it('ignores businesses they no longer belong to and anything unexpected', () => {
    expect(tapTarget({ tenant: 'elsewhere', screen: 'offers' }, mine)).toBeNull();
    expect(tapTarget({ ref: 'x' }, mine)).toBeNull();
    expect(tapTarget(null, mine)).toBeNull();
    expect(tapTarget('cafe', mine)).toBeNull();
  });
});
