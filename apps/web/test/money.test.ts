import { describe, expect, it } from 'vitest';
import { currencyOf, moneyFor } from '../lib/money';

describe('money in the business currency', () => {
  it('follows the country', () => {
    expect(currencyOf('NZ')).toBe('NZD');
    expect(currencyOf(undefined)).toBe('AUD');
    expect(moneyFor('AU')(1250)).toBe('$12.50');
    expect(moneyFor('GB')(1250)).toBe('£12.50');
    expect(moneyFor('US')(1250)).toBe('$12.50');
    expect(moneyFor('AU')(null)).toBe('—');
  });
});
