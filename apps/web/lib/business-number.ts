/**
 * A client's business number as the business's country writes it (backlog "Business number per country"). The API
 * checks and stores it (`apps/api/src/clients/business-number.ts`, keep the labels in step); this only names and shows it.
 */
const KINDS: Record<string, { label: string; hint: string }> = {
  AU: { label: 'ABN', hint: '11 digits' },
  NZ: { label: 'NZBN', hint: '13 digits' },
  US: { label: 'EIN', hint: '12-3456789' },
  GB: { label: 'Company number', hint: '8 characters' },
};

/** What the business's country calls a business number, and a short hint for the box. Unknown country = Australia's. */
export const businessNumberKind = (country: string | null | undefined) => KINDS[country ?? ''] ?? KINDS.AU;

/** A stored number written the usual way for its shape: ABN "51 824 753 556", EIN "12-3456789"; others as stored. */
export function showBusinessNumber(stored: string | null | undefined): string {
  if (!stored) return '—';
  if (/^\d{11}$/.test(stored)) return stored.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
  if (/^\d{9}$/.test(stored)) return `${stored.slice(0, 2)}-${stored.slice(2)}`;
  return stored;
}
