import { describe, expect, it } from 'vitest';
import { formatDate } from '../lib/format';

describe('formatDate', () => {
  it('shows a date as it is and a timestamp in the business time zone', () => {
    expect(formatDate('2026-10-31')).toBe('31 Oct 2026');
    expect(formatDate('2026-10-31T15:00:00Z', 'Australia/Perth')).toBe('31 Oct 2026');
    expect(formatDate('2026-10-31T15:00:00Z', 'Australia/Sydney')).toBe('1 Nov 2026');
    expect(formatDate(null)).toBe('—');
  });
});
