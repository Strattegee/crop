import { auditWho } from './audit';
import { showMobile } from './phone';

/**
 * Earlier values of a person's own details (David, 3 Nov 2026, answer 5: "nothing overwritten"), as the person's
 * Details tab shows them. The API (`GET /workers/:id/earlier-details`, `workforce/detail-history.ts`) reads them from
 * the audit log. Pure.
 */
export const EARLIER_FIELDS = ['name', 'preferred_name', 'email', 'mobile', 'gender', 'date_of_birth'] as const;
export type EarlierField = typeof EARLIER_FIELDS[number];
export type EarlierValue = { value: string | null; changedAt: string; by: string | null; via: string };
export type EarlierDetails = Record<EarlierField, EarlierValue[]>;

export const EARLIER_LABEL: Record<EarlierField, string> = {
  name: 'Name', preferred_name: 'Preferred name', email: 'Email', mobile: 'Mobile', gender: 'Gender', date_of_birth: 'Date of birth',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What it was, in the business's way of writing it: "0412 345 678", "Female", "3 Feb 2001", "Not recorded". */
export function earlierValue(field: EarlierField, value: string | null, country?: string | null): string {
  if (value === null || value === '') return 'Not recorded';
  if (field === 'mobile') return value.startsWith('+') ? showMobile(value, country) : value;
  if (field === 'gender') return value === 'F' ? 'Female' : value === 'M' ? 'Male' : value;
  if (field === 'date_of_birth') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : value;
  }
  return value;
}

/** "Until 3 Nov 2026 · changed by Ola Office (in the app)". */
export function earlierWhen(e: EarlierValue, when: (iso: string) => string): string {
  const by = e.by ?? (e.via === 'system' ? 'CROP' : e.via === 'link' ? 'Someone using a link' : null);
  return `Until ${when(e.changedAt)} · changed by ${auditWho(by, e.via)}`;
}

/** Every earlier value in field order (each field newest first), with the date of birth only when asked for. */
export function earlierRows(h: EarlierDetails | null, withBirthDate = true) {
  if (!h) return [];
  return EARLIER_FIELDS.filter(f => withBirthDate || f !== 'date_of_birth')
    .flatMap(f => (h[f] ?? []).map((e, i) => ({ key: `${f}-${i}`, field: f, label: EARLIER_LABEL[f], ...e })));
}

/** "3 Nov 2026, 2:15 pm" in the business's time zone (earlier values can be years old, so the year shows). */
export const changedIn = (zone: string) => (iso: string) =>
  new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone }).format(new Date(iso));
