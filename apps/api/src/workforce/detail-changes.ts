import type { CountryCode } from '../common/countries.js';
import { mobileProblem, parseMobile } from '../notifications/phone.js';
import { addressLine, parseAddress, type AddressFields } from './addresses.js';
import { personCan, type Access, type PersonField } from './field-access.js';

/**
 * Changes a person makes to their own details in the app (David, 3 Nov 2026, answer 5; migration 0087). The
 * business's field-access setting decides: `change` applies at once, `approve` waits for an owner or administrator,
 * `see` and `hidden` are refused. Pure: no database access.
 */
export const DETAIL_FIELDS = ['name', 'preferred_name', 'email', 'mobile', 'gender', 'address'] as const;
export type DetailField = typeof DETAIL_FIELDS[number];

export const ADDRESS_ACTIONS = ['add', 'correct', 'current', 'remove'] as const;
export type AddressAction = typeof ADDRESS_ACTIONS[number];

export const isDetailField = (v: unknown): v is DetailField => typeof v === 'string' && (DETAIL_FIELDS as readonly string[]).includes(v);

/** The field-access setting a change is governed by. */
export const accessField = (f: DetailField): PersonField => (f === 'address' ? 'addresses' : f);

export const DETAIL_LABEL: Record<DetailField, string> = {
  name: 'Name', preferred_name: 'Preferred name', email: 'Email', mobile: 'Mobile', gender: 'Gender', address: 'Address',
};

/** Why the person can't change this in the app (null = they can, now or with approval). */
export function changeRefusal(f: DetailField, access: Access): string | null {
  const can = personCan(access);
  const what = f === 'address' ? 'your addresses' : `your ${DETAIL_LABEL[f].toLowerCase()}`;
  if (!can.see) return `The office keeps ${what}: ask them if it needs changing`;
  if (!can.change) return `Ask the office to change ${what}`;
  return null;
}

/** What a stored change holds: one value, the name, or an address (with what to do with it). */
export type Asked =
  | { value: string | null }
  | { firstName: string; lastName: string }
  | AddressFields;

const clean = (v: unknown, max: number, label: string): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new DetailProblem(`${label} must be text`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length > max) throw new DetailProblem(`${label} is too long (${max} characters at most)`);
  return s || null;
};

class DetailProblem extends Error {}

/**
 * Reads the asked value for one field from a request body (`value`, or `firstName` + `lastName` for the name; the
 * address fields for an address added or corrected). Mobiles are read in the business's country and stored in
 * international form; gender is F, M or blank. Returns the value or a plain problem.
 */
export function parseAsked(f: DetailField, body: Record<string, unknown>, country: CountryCode, action?: AddressAction): { asked: Asked | null } | { problem: string } {
  try {
    switch (f) {
      case 'name': {
        const firstName = clean(body.firstName, 100, 'First name');
        const lastName = clean(body.lastName, 100, 'Last name');
        if (!firstName || !lastName) return { problem: 'Enter your first and last name' };
        return { asked: { firstName, lastName } };
      }
      case 'preferred_name':
        return { asked: { value: clean(body.value, 100, 'Preferred name') } };
      case 'email': {
        const v = clean(body.value, 200, 'Email');
        if (!v) return { problem: 'Enter your email address' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { problem: 'That isn’t an email address' };
        return { asked: { value: v.toLowerCase() } };
      }
      case 'mobile': {
        const v = clean(body.value, 30, 'Mobile');
        if (!v) return { asked: { value: null } };
        const m = parseMobile(country, v);
        return m ? { asked: { value: m.e164 } } : { problem: mobileProblem(country) };
      }
      case 'gender': {
        const v = body.value;
        if (v === null || v === undefined || v === '') return { asked: { value: null } };
        if (v !== 'F' && v !== 'M') return { problem: 'Choose female, male or not saying' };
        return { asked: { value: v } };
      }
      case 'address': {
        if (action === 'current' || action === 'remove') return { asked: null };
        const parsed = parseAddress(body, country);
        return 'problem' in parsed ? parsed : { asked: parsed.address };
      }
    }
  } catch (e) {
    if (e instanceof DetailProblem) return { problem: e.message };
    throw e;
  }
}

const GENDER_WORD: Record<string, string> = { F: 'Female', M: 'Male' };

/** A value in words, for the office's list and the person's pending line ("Not given" when blank). */
export function valueLine(f: DetailField, v: unknown, home: CountryCode): string {
  if (!v || typeof v !== 'object') return 'Not given';
  const o = v as Record<string, unknown>;
  if (f === 'name') return `${o.firstName ?? ''} ${o.lastName ?? ''}`.trim() || 'Not given';
  if (f === 'address') return typeof o.line1 === 'string' ? addressLine(o as unknown as AddressFields, home) : 'Not given';
  if (o.value === null || o.value === undefined || o.value === '') return 'Not given';
  if (f === 'gender') return GENDER_WORD[String(o.value)] ?? 'Not given';
  return String(o.value);
}

/** "Change their mobile", "Add an address", "Make an address current", "Take an address off the list". */
export function changeWhat(f: DetailField, action: AddressAction | null): string {
  if (f !== 'address') return `Change ${DETAIL_LABEL[f].toLowerCase()}`;
  switch (action) {
    case 'add': return 'Add an address';
    case 'correct': return 'Correct an address';
    case 'current': return 'Make an address current';
    case 'remove': return 'Take an address off the list';
    default: return 'Change an address';
  }
}

/** True when nothing would change (so nothing is applied or asked). */
export function sameValue(asked: Asked | null, was: Asked | null): boolean {
  if (!asked || !was) return false;
  const a = asked as Record<string, unknown>, b = was as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(k => (a[k] ?? null) === (b[k] ?? null));
}

export type DetailStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** Why the office can't decide this one now. */
export function decideRefusal(status: DetailStatus): string | null {
  if (status === 'withdrawn') return 'They withdrew this change';
  if (status !== 'pending') return 'This change has already been decided';
  return null;
}

/** The message to the person once decided (push in the app, else email). The office's note is written for them. */
export function decidedMessage(firstName: string, what: string, outcome: 'approved' | 'declined', note: string | null, business: string) {
  const line = outcome === 'approved' ? `Your change (${what.toLowerCase()}) has been approved.` : `Your change (${what.toLowerCase()}) wasn't approved.`;
  const body = `${line}${note ? ` ${note}` : ''}`;
  return {
    push: { title: outcome === 'approved' ? 'Your details are updated' : 'About your details', body },
    email: { subject: `${business}: your details`, body: `Hi ${firstName},\n\n${body}\n\n${business}` },
  };
}

/** The email to owners and admins: who asked and what kind of change, never the values (they open CROP for that). */
export function toApproveEmail(personName: string, what: string, business: string, link: string | null) {
  return {
    subject: `${business}: ${personName} asked to change their details`,
    body: `${personName} asked in the app: ${what.toLowerCase()}.\n\nApprove or decline it in CROP${link ? `: ${link}` : ' (Dashboard, Waiting on a decision)'}.\n\n${business}`,
  };
}
