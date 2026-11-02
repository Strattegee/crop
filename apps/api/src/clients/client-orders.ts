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

export const CHANNELS = ['email', 'phone', 'portal', 'other'] as const;
export type Channel = typeof CHANNELS[number];
export const CHANNEL_WORDS: Record<Channel, string> = { email: 'Email', phone: 'Phone', portal: 'Portal', other: 'Other' };

export interface OrderFields {
  clientId: string;
  channel: Channel;
  requestedByName: string;
  requestedByEmail: string | null;
  requestedByPhone: string | null;
  clientReference: string | null;
  orderNotes: string | null;
  confirmToClient: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The order's own fields (the shifts are checked by `parseShiftRequest`). Throws plain-English 400s. */
export function parseOrder(body: Record<string, unknown>): OrderFields {
  const clientId = text(body, 'clientId', { max: 40 });
  if (!clientId || !UUID.test(clientId)) throw new BadRequestException('Choose {a client}');
  const channel = text(body, 'channel', { max: 20 }) ?? 'other';
  if (!(CHANNELS as readonly string[]).includes(channel)) throw new BadRequestException('How they asked must be email, phone, portal or other');
  const requestedByName = text(body, 'requestedByName', { required: true, max: 120 })!;
  const requestedByEmail = email(body, 'requestedByEmail');
  const requestedByPhone = text(body, 'requestedByPhone', { max: 40 });
  const clientReference = text(body, 'clientReference', { max: 60 });
  const orderNotes = text(body, 'orderNotes', { max: 1000 });
  const confirmToClient = bool(body, 'confirmToClient') ?? true;
  return { clientId, channel: channel as Channel, requestedByName, requestedByEmail, requestedByPhone, clientReference, orderNotes, confirmToClient };
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
  const subject = `Booked: ${f.personName} for ${place(f)}, ${when}${ref}`;
  const lines = [
    `Hello ${f.contactName},`,
    '',
    `${f.personName} (${f.role}) is booked for the ${w.lower(T.shift)} you asked ${f.businessName} for:`,
    '',
    `${w.one(T.site)}: ${f.siteName}`,
    ...(f.areaName ? [`${w.one(T.area)}: ${f.areaName}`] : []),
    `When: ${when}`,
    ...(f.clientReference ? [`Your reference: ${f.clientReference}`] : []),
    '',
    `If anything changes, please contact ${f.businessName}.`,
    '',
    'Thanks,',
    f.businessName,
  ];
  return { subject, body: lines.join('\n') };
}

export interface OrderCounts { total: number; booked: number; assigned: number; open: number; cancelled: number }

/** One line for an order: "2 of 3 filled", "2 of 3 filled · 1 waiting to confirm · 1 cancelled", "Cancelled". */
export function orderSummary(c: OrderCounts, w: Words = DEFAULT_WORDS): string {
  const live = c.total - c.cancelled;
  if (c.total > 0 && live === 0) return 'Cancelled';
  const parts = [live === c.booked && live > 0 ? `All ${w.count(live, T.shift)} filled` : `${c.booked} of ${live} filled`];
  if (c.assigned) parts.push(`${c.assigned} waiting to confirm`);
  if (c.cancelled) parts.push(`${c.cancelled} cancelled`);
  return parts.join(' · ');
}

export type ClientShiftStage = 'open' | 'offered' | 'assigned' | 'booked';

/** A client shift's stage for the allocation screen (same order as the roster's colours). */
export function clientShiftStage(s: { status: string; offersPending: number }): ClientShiftStage {
  if (s.status === 'booked') return 'booked';
  if (s.status === 'assigned') return 'assigned';
  return s.offersPending > 0 ? 'offered' : 'open';
}
