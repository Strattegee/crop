import { describe, expect, it } from 'vitest';
import { pushPlatform, Registered, shouldAsk } from '../src/push-rules';

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
