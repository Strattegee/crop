import { describe, expect, it } from 'vitest';
import { noticeLine } from '../lib/worker-notice';

describe('worker privacy notice line', () => {
  const day = (s: string) => s.slice(0, 10);
  it('says whether and when the person confirmed the notice', () => {
    expect(noticeLine('Ana', null, day)).toBe('Ana is shown the worker privacy notice the first time they open the app.');
    expect(noticeLine('Ana', { version: 'v1', acknowledgedAt: '2026-11-01T01:00:00Z', current: true }, day))
      .toBe('Ana confirmed reading the worker privacy notice on 2026-11-01.');
    expect(noticeLine('Ana', { version: 'v0', acknowledgedAt: '2026-10-01T01:00:00Z', current: false }, day))
      .toMatch(/^Ana confirmed an earlier version .* on 2026-10-01; the app shows them the new one/);
  });
});
