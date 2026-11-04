/**
 * Client orders (David, 2 Nov 2026; migration 0068). Pure rules: no database access.
 *
 * A business that supplies staff to its clients takes their orders by email, phone or the client's portal and types
 * them in: who asked, how, their reference, and the shifts wanted at one of the client's sites. When one of those
 * shifts is booked, the person who asked is emailed the name of whoever is going and the shift. Never health
 * information or document numbers; just the person's name, the role and the shift.
 */
import { BadRequestException } from '@nestjs/common';
import { bool, email, text } from '../common/validate.js';
import { fmtDate } from '../roster/eligibility.js';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

export const CHANNELS = ['email', 'phone', 'portal', 'other', 'request_page'] as const;
export type Channel = typeof CHANNELS[number];
export const CHANNEL_WORDS: Record<Channel, string> = { email: 'Email', phone: 'Phone', portal: 'Portal', other: 'Other', request_page: 'Request page' };

export interface OrderFields {
  clientId: string;
  channel: Channel;
  requestedByName: string;
  requestedByEmail: string | null;
  requestedByPhone: string | null;
  clientReference: string | null;
  orderNotes: string | null;
  confirmToClient: boolean;
  /** A saved contact of this client (migration 0072): fills who asked where the order leaves it out. */
  contactId: string | null;
  /** Save the typed details as a new contact of the client (or link the live one of that name). */
  saveContact: boolean;
  /** The new customer's request this order is taken from (migration 0091), or null. */
  customerRequestId: string | null;
}

/** A client contact as stored (migration 0072). */
export interface ContactFields {
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

/** A new contact's fields. Throws plain-English 400s. */
export function parseContact(body: Record<string, unknown>): ContactFields {
  return {
    name: text(body, 'name', { required: true, max: 120 })!,
    position: text(body, 'position', { max: 120 }),
    email: email(body, 'email'),
    phone: text(body, 'phone', { max: 40 }),
    notes: text(body, 'notes', { max: 500 }),
  };
}

/**
 * Who asked, from what was typed and the saved contact picked (typed details win field by field, so the office can
 * take an order from a contact at a different number). Null name means neither gave one.
 */
export function whoAsked(
  order: Pick<OrderFields, 'requestedByName' | 'requestedByEmail' | 'requestedByPhone'>,
  contact: { name: string; email: string | null; phone: string | null } | null,
): { name: string | null; email: string | null; phone: string | null } {
  return {
    name: order.requestedByName || contact?.name || null,
    email: order.requestedByEmail ?? contact?.email ?? null,
    phone: order.requestedByPhone ?? contact?.phone ?? null,
  };
}

/** Why a saved contact can't be used on an order for this client, or null. */
export function contactProblem(contact: { clientId: string; active: boolean } | undefined, clientId: string): string | null {
  if (!contact) return 'That contact wasn’t found. Choose another or type who asked.';
  if (contact.clientId !== clientId) return 'That contact is with another {client}. Choose one of this {client}’s contacts or type who asked.';
  if (!contact.active) return 'That contact is switched off. Choose another or type who asked.';
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The order's own fields (the shifts are checked by `parseShiftRequest`). Throws plain-English 400s. */
export function parseOrder(body: Record<string, unknown>): OrderFields {
  const clientId = text(body, 'clientId', { max: 40 });
  if (!clientId || !UUID.test(clientId)) throw new BadRequestException('Choose {a client}');
  const channel = text(body, 'channel', { max: 20 }) ?? 'other';
  if (!(CHANNELS as readonly string[]).includes(channel)) throw new BadRequestException('How they asked must be email, phone, portal or other');
  const contactId = text(body, 'contactId', { max: 40 });
  if (contactId && !UUID.test(contactId)) throw new BadRequestException('Choose a saved contact or type who asked');
  const requestedByName = text(body, 'requestedByName', { required: !contactId, max: 120 }) ?? '';
  const requestedByEmail = email(body, 'requestedByEmail');
  const requestedByPhone = text(body, 'requestedByPhone', { max: 40 });
  const clientReference = text(body, 'clientReference', { max: 60 });
  const orderNotes = text(body, 'orderNotes', { max: 1000 });
  const confirmToClient = bool(body, 'confirmToClient') ?? true;
  const saveContact = !contactId && (bool(body, 'saveContact') ?? false);
  // An order taken from a new customer's request (migration 0091): the request it came from, accepted for this client.
  const customerRequestId = text(body, 'customerRequestId', { max: 40 });
  if (customerRequestId && !UUID.test(customerRequestId)) throw new BadRequestException('Choose the request this order is for');
  return {
    clientId, channel: channel as Channel, requestedByName, requestedByEmail, requestedByPhone, clientReference, orderNotes, confirmToClient, contactId, saveContact,
    customerRequestId: customerRequestId ?? null,
  };
}

/** Why an order can't go on this client and site, or null. Tokens are filled with the business's words. */
export function orderPlaceProblem(
  client: { status: string } | undefined,
  site: { clientId: string | null; active: boolean } | undefined,
  clientId: string,
): string | null {
  if (!client) return 'Choose {a client}';
  if (client.status !== 'active') return 'This {client} isn’t active, so it can’t take orders. Change its status first.';
  if (!site) return 'Choose {a site}';
  if (site.clientId !== clientId) return 'That {site} doesn’t belong to this {client}. Choose one of their {sites}.';
  if (!site.active) return 'That {site} is switched off';
  return null;
}

export interface ConfirmationFacts {
  contactName: string;
  businessName: string;
  personName: string;
  role: string;
  siteName: string;
  areaName: string | null;
  localDate: string;
  localStart: string;
  localEnd: string;
  clientReference: string | null;
  /** The client confirms each booking before it counts as filled (`clients.confirms_bookings`): the email asks them to. */
  askToConfirm?: boolean;
}

/** "Ward 4, Bayside Hospital" (area first when there is one). */
const place = (f: Pick<ConfirmationFacts, 'siteName' | 'areaName'>) => (f.areaName ? `${f.areaName}, ${f.siteName}` : f.siteName);

/**
 * The email to the client when a shift on their order is booked:
 * "Sarah Nguyen (Registered Nurse) is booked for Ward 4, Bayside Hospital, Tue 10 Nov 07:00–15:30".
 */
export function clientConfirmationEmail(f: ConfirmationFacts, w: Words = DEFAULT_WORDS) {
  const when = `${fmtDate(f.localDate)} ${f.localStart}–${f.localEnd}`;
  const ref = f.clientReference ? ` (your ref ${f.clientReference})` : '';
  const subject = `${f.askToConfirm ? 'Please confirm' : 'Booked'}: ${f.personName} for ${place(f)}, ${when}${ref}`;
  const lines = [
    `Hello ${f.contactName},`,
    '',
    f.askToConfirm
      ? `${f.businessName} has ${f.personName} (${f.role}) ready for the ${w.lower(T.shift)} you asked for. Please confirm you're happy with them:`
      : `${f.personName} (${f.role}) is booked for the ${w.lower(T.shift)} you asked ${f.businessName} for:`,
    '',
    `${w.one(T.site)}: ${f.siteName}`,
    ...(f.areaName ? [`${w.one(T.area)}: ${f.areaName}`] : []),
    `When: ${when}`,
    ...(f.clientReference ? [`Your reference: ${f.clientReference}`] : []),
    '',
    ...(f.askToConfirm
      ? [`Please reply to this email or call ${f.businessName} to confirm. If they aren't suitable, let us know and we'll find someone else.`]
      : [`If anything changes, please contact ${f.businessName}.`]),
    '',
    'Thanks,',
    f.businessName,
  ];
  return { subject, body: lines.join('\n') };
}

export type ChangeKind = 'cancelled' | 'removed' | 'changed';

export interface ChangeFacts {
  kind: ChangeKind;
  contactName: string;
  businessName: string;
  /** The person the client was told about (name they go by and last name). */
  personName: string;
  siteName: string;
  /** Where and when now (for a cancellation or removal, the shift as it stands). */
  areaName: string | null;
  localDate: string;
  localStart: string;
  localEnd: string;
  /** What the client was told before ('changed' only). */
  wasAreaName?: string | null;
  wasLocalDate?: string;
  wasLocalStart?: string;
  wasLocalEnd?: string;
  clientReference: string | null;
  /** 'removed': someone else is already booked (their own booked email tells the client who). */
  someoneElseBooked?: boolean;
}

/**
 * The email to the client when a booking they were told about changes: the shift is cancelled, the person is no
 * longer going (never why: it may be personal), or the date, times or area change while they're still going.
 */
export function clientChangeEmail(f: ChangeFacts, w: Words = DEFAULT_WORDS) {
  const shift = w.lower(T.shift);
  const when = `${fmtDate(f.localDate)} ${f.localStart}–${f.localEnd}`;
  const ref = f.clientReference ? ` (your ref ${f.clientReference})` : '';
  const wasWhen = f.wasLocalDate ? `${fmtDate(f.wasLocalDate)} ${f.wasLocalStart}–${f.wasLocalEnd}` : when;
  const subject =
    f.kind === 'cancelled' ? `Cancelled: ${place(f)}, ${when}${ref}`
    : f.kind === 'removed' ? `Change of person: ${place(f)}, ${when}${ref}`
    : `Changed: ${place(f)}, now ${when}${ref}`;
  const intro =
    f.kind === 'cancelled' ? `The ${shift} below, which you asked ${f.businessName} for, has been cancelled.`
    : f.kind === 'removed' ? `${f.personName} is no longer going to the ${shift} below.`
    : `The ${shift} below has changed. ${f.personName} is still going.`;
  const next =
    f.kind === 'cancelled' ? `If you didn't expect this, please contact ${f.businessName}.`
    : f.kind === 'removed'
      ? (f.someoneElseBooked
        ? `Someone else is booked instead: we've emailed you separately with who is going.`
        : `${f.businessName} is finding someone else and will email you when they're booked.`)
    : `If this doesn't suit you, please contact ${f.businessName}.`;
  const areaChanged = f.kind === 'changed' && (f.wasAreaName ?? null) !== (f.areaName ?? null);
  const timeChanged = f.kind === 'changed' && wasWhen !== when;
  const lines = [
    `Hello ${f.contactName},`,
    '',
    intro,
    '',
    `${w.one(T.site)}: ${f.siteName}`,
    ...(f.areaName || areaChanged ? [`${w.one(T.area)}: ${f.areaName ?? 'none'}${areaChanged ? ` (was ${f.wasAreaName ?? 'none'})` : ''}`] : []),
    `When: ${when}${timeChanged ? ` (was ${wasWhen})` : ''}`,
    ...(f.clientReference ? [`Your reference: ${f.clientReference}`] : []),
    '',
    next,
    '',
    'Thanks,',
    f.businessName,
  ];
  return { subject, body: lines.join('\n') };
}

export interface OrderCounts { total: number; booked: number; assigned: number; open: number; cancelled: number; toConfirm?: number }

/**
 * One line for an order: "2 of 3 filled", "2 of 3 filled · 1 waiting to confirm · 1 cancelled", "Cancelled";
 * booked ones the client still has to confirm add "1 for the client to confirm".
 */
export function orderSummary(c: OrderCounts, w: Words = DEFAULT_WORDS): string {
  const live = c.total - c.cancelled;
  if (c.total > 0 && live === 0) return 'Cancelled';
  const parts = [live === c.booked && live > 0 ? `All ${w.count(live, T.shift)} filled` : `${c.booked} of ${live} filled`];
  if (c.assigned) parts.push(`${c.assigned} waiting to confirm`);
  if (c.toConfirm) parts.push(`${c.toConfirm} for the ${w.lower(T.client)} to confirm`);
  if (c.cancelled) parts.push(`${c.cancelled} cancelled`);
  return parts.join(' · ');
}

export type ClientShiftStage = 'open' | 'offered' | 'assigned' | 'worker_to_confirm' | 'client_to_confirm' | 'booked';
export const CLIENT_SHIFT_STAGES: readonly ClientShiftStage[] = ['open', 'offered', 'assigned', 'worker_to_confirm', 'client_to_confirm', 'booked'];

type ConfirmFacts = { status: string; clientConfirms?: boolean; clientConfirmedAt?: string | Date | null };

/** Whether the client still has to confirm the person booked (their client confirms bookings, not yet confirmed). */
export const waitsForClient = (s: ConfirmFacts) =>
  s.status === 'booked' && Boolean(s.clientConfirms) && !s.clientConfirmedAt;

/** Whether the client has said yes to the person on the shift, who hasn't confirmed yet (their client confirms bookings). */
export const waitsForWorker = (s: ConfirmFacts) =>
  s.status === 'assigned' && Boolean(s.clientConfirms) && Boolean(s.clientConfirmedAt);

/**
 * A client shift's stage for the allocation screen (same order as the roster's colours). When the client confirms each
 * booking (David, 2 Nov: "both client and worker must confirm before it is finalised"), either side can say yes
 * first: assigned with the client's yes is "worker to confirm", booked without it is "client to confirm"; only both
 * is booked. The shift's own status (open / assigned / booked) is unchanged; this is the allocation stage on top.
 */
export function clientShiftStage(s: ConfirmFacts & { offersPending: number }): ClientShiftStage {
  if (waitsForClient(s)) return 'client_to_confirm';
  if (waitsForWorker(s)) return 'worker_to_confirm';
  if (s.status === 'booked') return 'booked';
  if (s.status === 'assigned') return 'assigned';
  return s.offersPending > 0 ? 'offered' : 'open';
}

/**
 * Why the office can't record the client's yes on this shift, or null. Tokens are filled with the business's words.
 * The client can say yes as soon as someone is on the shift (allocated or booked); it counts for that person only.
 */
export function clientConfirmRefusal(s: {
  onOrder: boolean; clientConfirms: boolean; status: string; started: boolean; clientConfirmedAt: string | Date | null;
}): string | null {
  if (!s.onOrder) return 'This {shift} isn’t from a {client}’s order';
  if (!s.clientConfirms) return 'This {client} doesn’t confirm bookings. Change that in the {client}’s set-up if they should.';
  if (s.status !== 'booked' && s.status !== 'assigned') return 'Put someone on the {shift} first: the {client} confirms the person';
  if (s.started) return 'This {shift} has already started';
  if (s.clientConfirmedAt) return 'The {client} has already confirmed this person';
  return null;
}
