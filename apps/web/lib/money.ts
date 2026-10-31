/**
 * Money in the business's currency (backlog: currency per business). The currency follows the business's country
 * (Settings): AUD, NZD, USD or GBP; amounts are stored in cents. Pure, tested in test/money.test.ts.
 */
const BY_COUNTRY: Record<string, { currency: string; locale: string }> = {
  AU: { currency: 'AUD', locale: 'en-AU' }, NZ: { currency: 'NZD', locale: 'en-NZ' },
  US: { currency: 'USD', locale: 'en-US' }, GB: { currency: 'GBP', locale: 'en-GB' },
};

export const currencyOf = (country?: string | null) => (BY_COUNTRY[country ?? ''] ?? BY_COUNTRY.AU).currency;

/** A formatter for cents in the business's currency: "$12.50", "£12.50"; a dash for none. */
export function moneyFor(country?: string | null) {
  const c = BY_COUNTRY[country ?? ''] ?? BY_COUNTRY.AU;
  const f = new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.currency });
  return (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : f.format(cents / 100));
}
