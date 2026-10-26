import { describe, expect, it } from 'vitest';
import { isExampleAddress } from '../src/notifications/notify.js';

describe('example addresses', () => {
  it('recognises reserved demo domains only', () => {
    for (const e of ['mia.chen@example.com', 'a@EXAMPLE.org', 'x@shop.test', 'y@foo.example', 'z@bar.invalid']) expect(isExampleAddress(e), e).toBe(true);
    for (const e of ['david@strattegee.com', 'a@example.com.au', 'b@myexample.com', 'c@test.com']) expect(isExampleAddress(e), e).toBe(false);
  });
});
