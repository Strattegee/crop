/**
 * Showing a person's mobile (backlog "Phone numbers and texts per country", 3 Nov). The API stores mobiles in
 * international form (+61412345678) and reads typed numbers the way the business's country writes them
 * (`apps/api/src/notifications/phone.ts`, keep the examples in step). Numbers saved before then may be in any form
 * and are shown as they are.
 */
const EXAMPLE: Record<string, string> = { AU: '0412 345 678', NZ: '021 123 4567', US: '(212) 555-0123', GB: '07700 900123' };

/** A placeholder for the Mobile box in the business's country. Unknown country = Australia's. */
export const mobileExample = (country: string | null | undefined) => EXAMPLE[country ?? ''] ?? EXAMPLE.AU;

const CODE: Record<string, string> = { '61': 'AU', '64': 'NZ', '1': 'US', '44': 'GB' };

function split(e164: string): { country: string; nsn: string } | null {
  const m = e164.match(/^\+(61|64|1|44)(\d{7,11})$/);
  return m ? { country: CODE[m[1]], nsn: m[2] } : null;
}

/** The national form: 0412 345 678, 021 123 4567, (212) 555-0123, 07700 900123. */
function national(country: string, nsn: string): string {
  if (country === 'AU') return `0${nsn.slice(0, 3)} ${nsn.slice(3, 6)} ${nsn.slice(6)}`;
  if (country === 'NZ') {
    const rest = nsn.slice(2);
    const head = rest.length > 7 ? 4 : 3;
    return `0${nsn.slice(0, 2)} ${rest.slice(0, head)} ${rest.slice(head)}`;
  }
  if (country === 'US') return `(${nsn.slice(0, 3)}) ${nsn.slice(3, 6)}-${nsn.slice(6)}`;
  return `0${nsn.slice(0, 4)} ${nsn.slice(4)}`;
}

/** The international form with spaces, for a number from another country: +64 21 123 4567. */
function international(country: string, nsn: string): string {
  const code = Object.keys(CODE).find(k => CODE[k] === country)!;
  const local = national(country, nsn);
  const spaced = country === 'US' ? local.replace(/[()]/g, '').replace('-', ' ') : local.slice(1);
  return `+${code} ${spaced}`;
}

/** A stored mobile as the business's people write it: local form when it's from the business's country, else with its country code. */
export function showMobile(stored: string | null | undefined, country: string | null | undefined): string {
  if (!stored) return '';
  const p = split(stored);
  if (!p) return stored;
  return p.country === (country ?? 'AU') ? national(p.country, p.nsn) : international(p.country, p.nsn);
}

/** A tel: link for a stored mobile (spaces and brackets left out). */
export const telHref = (stored: string) => `tel:${stored.replace(/[^\d+]/g, '')}`;
