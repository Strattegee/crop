/**
 * My details in the app (David, 3 Nov 2026, answer 5): the person's own details as their business lets them see
 * them (`GET /my/details`), changed at once or sent to the office for approval. Pure helpers, tested in
 * test/details.spec.ts. Mobiles come back in international form and are shown the business's way (`showMobile`).
 */
export type DetailField = 'name' | 'preferred_name' | 'email' | 'mobile' | 'gender';

export interface MyField { field: DetailField; label: string; value: string | null; raw: unknown; canChange: boolean; needsApproval: boolean }
export interface MyAddress {
  id: string; label: string | null; line: string; current: boolean;
  fields: { label: string | null; line1: string; line2: string | null; suburb: string | null; state: string | null; postcode: string | null; country: string };
}
export interface MyChange {
  id: string; field: DetailField | 'address'; addressId: string | null; label: string; what: string; line: string; status: 'pending' | 'approved' | 'declined';
  note: string | null; canWithdraw: boolean;
}
export interface MyDetails {
  country: string;
  fields: MyField[];
  addresses: { canChange: boolean; needsApproval: boolean; list: MyAddress[] } | null;
  changes: MyChange[];
}

export const CHANGE_STATUS: Record<MyChange['status'], string> = {
  pending: 'Waiting for the office', approved: 'Approved', declined: 'Not approved',
};

const CODE: Record<string, string> = { '61': 'AU', '64': 'NZ', '1': 'US', '44': 'GB' };

/** A stored mobile the business's way: 0412 345 678 at home, +64 21 123 4567 from elsewhere; anything else as stored. */
export function showMobile(stored: string | null, country: string): string {
  if (!stored) return '';
  const m = stored.match(/^\+(61|64|1|44)(\d{7,11})$/);
  if (!m) return stored;
  const c = CODE[m[1]], n = m[2];
  const local = c === 'AU' ? `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`
    : c === 'NZ' ? `0${n.slice(0, 2)} ${n.slice(2, n.length > 9 ? 6 : 5)} ${n.slice(n.length > 9 ? 6 : 5)}`
      : c === 'US' ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`
        : `0${n.slice(0, 4)} ${n.slice(4)}`;
  if (c === country) return local;
  return `+${m[1]} ${c === 'US' ? local.replace(/[()]/g, '').replace('-', ' ') : local.slice(1)}`;
}

/** A field's value as shown: the mobile the business's way, blank as "Not given". */
export function fieldValue(f: MyField, country: string): string {
  if (!f.value) return 'Not given';
  return f.field === 'mobile' ? showMobile(f.value, country) : f.value;
}

/** What the button says: changes that need approval are "sent", others are "saved". */
export const saveLabel = (needsApproval: boolean) => (needsApproval ? 'Send to the office' : 'Save');

/** What to tell them after a change. */
export function doneMessage(outcome: 'changed' | 'requested'): { title: string; body?: string } {
  return outcome === 'changed' ? { title: 'Saved' } : { title: 'Sent to the office', body: 'It changes once they approve it. You’ll be told.' };
}

/** What's wrong before sending, or null. */
export function fieldProblem(field: DetailField, input: { value?: string; firstName?: string; lastName?: string }): string | null {
  if (field === 'name') return !input.firstName?.trim() || !input.lastName?.trim() ? 'Enter your first and last name' : null;
  if (field === 'email') return !input.value?.trim() ? 'Enter your email address' : null;
  return null;
}

/** The body for POST /my/details. Gender: 'F', 'M' or '' (not saying). */
export function fieldBody(field: DetailField, input: { value?: string; firstName?: string; lastName?: string }) {
  if (field === 'name') return { field, firstName: input.firstName?.trim() ?? '', lastName: input.lastName?.trim() ?? '' };
  return { field, value: input.value?.trim() ?? '' };
}

/** The starting text in the change form: the stored value (mobiles the business's way). */
export function startValue(f: MyField, country: string): { value: string; firstName: string; lastName: string } {
  const raw = f.raw as { firstName?: string; lastName?: string } | string | null;
  if (f.field === 'name' && raw && typeof raw === 'object') return { value: '', firstName: raw.firstName ?? '', lastName: raw.lastName ?? '' };
  const v = typeof raw === 'string' ? raw : '';
  return { value: f.field === 'mobile' ? showMobile(v, country) : v, firstName: '', lastName: '' };
}

export type AddressInput = { label: string; line1: string; line2: string; suburb: string; state: string; postcode: string };
export const EMPTY_ADDRESS: AddressInput = { label: '', line1: '', line2: '', suburb: '', state: '', postcode: '' };

export const addressInput = (a: MyAddress): AddressInput => ({
  label: a.fields.label ?? '', line1: a.fields.line1, line2: a.fields.line2 ?? '', suburb: a.fields.suburb ?? '', state: a.fields.state ?? '', postcode: a.fields.postcode ?? '',
});

/** The body for adding (no id) or correcting an address. */
export function addressBody(a: AddressInput, addressId?: string) {
  return { field: 'address', action: addressId ? 'correct' : 'add', ...(addressId ? { addressId } : {}), ...a };
}

/** A waiting change for this field already? (one at a time). */
export const waitingFor = (changes: MyChange[], field: MyChange['field'], addressId: string | null = null) =>
  changes.some(c => c.field === field && c.status === 'pending' && (field !== 'address' || c.addressId === addressId));
