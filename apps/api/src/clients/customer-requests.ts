/**
 * New customers asking for staff online (David, 3 Nov 2026, answer 4; migration 0089). Pure rules: reading the public
 * form, what the office sees, and the office's email. Nothing here touches the database.
 */

export const FREQUENCIES = ['once', 'repeat'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const REQUEST_STATUSES = ['new', 'accepted', 'declined'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** How far ahead a customer may ask for. */
export const MAX_DAYS_AHEAD = 180;
/** Limits on the public page so it can't be used to flood a business. */
export const MAX_PER_HOUR = 30;
export const MAX_PER_EMAIL_PER_DAY = 5;
export const MAX_PEOPLE = 20;

export interface CustomerRequestInput {
  businessName: string;
  contactName: string;
  email: string;
  phone: string | null;
  frequency: Frequency;
  siteName: string | null;
  address: string;
  suburb: string | null;
  region: string | null;
  postcode: string | null;
  role: string;
  date: string;
  startTime: string;
  endTime: string;
  people: number;
  notes: string | null;
}

/** Field names as the customer sees them on the form. */
const LABEL: Record<string, string> = {
  businessName: 'Business or organisation', contactName: 'Your name', email: 'Your email', phone: 'Your phone',
  frequency: 'Once or ongoing', siteName: 'Site name', address: 'Street address', suburb: 'Suburb or town', region: 'State or region',
  postcode: 'Postcode', role: 'Who you need', date: 'Date', startTime: 'Start time', endTime: 'Finish time', people: 'How many people',
  notes: 'Anything else we should know',
};

export class RequestProblem extends Error {}

const problem = (m: string): never => { throw new RequestProblem(m); };

function str(body: Record<string, unknown>, key: string, max: number, required: boolean): string | null {
  const v = body[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    return required ? problem(`${LABEL[key]} is needed`) : null;
  }
  if (typeof v !== 'string') return problem(`${LABEL[key]} must be text`);
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length > max) problem(`${LABEL[key]} is too long (at most ${max} characters)`);
  return t;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE = /^[+()\d\s-]{6,30}$/;

function addDays(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/**
 * Reads the public form. `today` is the business's date. Throws `RequestProblem` with a message for the customer.
 * Notes are free text, so the form asks for no health or personal details of anyone.
 */
export function parseCustomerRequest(body: Record<string, unknown> | null | undefined, today: string): CustomerRequestInput {
  const b = body ?? {};
  const email = str(b, 'email', 254, true)!.toLowerCase();
  if (!EMAIL.test(email)) problem('Your email doesn’t look right');
  const phone = str(b, 'phone', 30, false);
  if (phone && !PHONE.test(phone)) problem('Your phone should be digits only (spaces, + and brackets are fine)');
  const frequency = str(b, 'frequency', 10, false) ?? 'once';
  if (!(FREQUENCIES as readonly string[]).includes(frequency)) problem('Choose once or ongoing');
  const date = str(b, 'date', 10, true)!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    problem('Choose a date');
  }
  if (date < today) problem('The date has passed: choose today or later');
  if (date > addDays(today, MAX_DAYS_AHEAD)) problem(`Choose a date within ${MAX_DAYS_AHEAD} days`);
  const startTime = str(b, 'startTime', 5, true)!;
  const endTime = str(b, 'endTime', 5, true)!;
  if (!TIME.test(startTime)) problem('Start time should look like 07:00');
  if (!TIME.test(endTime)) problem('Finish time should look like 15:30');
  if (startTime === endTime) problem('The finish time is the same as the start');
  const rawPeople = b.people;
  const people = typeof rawPeople === 'number' ? rawPeople : typeof rawPeople === 'string' && rawPeople.trim() ? Number(rawPeople) : 1;
  if (!Number.isInteger(people) || people < 1 || people > MAX_PEOPLE) problem(`How many people should be 1 to ${MAX_PEOPLE}`);
  return {
    businessName: str(b, 'businessName', 200, true)!,
    contactName: str(b, 'contactName', 200, true)!,
    email, phone, frequency: frequency as Frequency,
    siteName: str(b, 'siteName', 200, false),
    address: str(b, 'address', 300, true)!,
    suburb: str(b, 'suburb', 100, false),
    region: str(b, 'region', 100, false),
    postcode: str(b, 'postcode', 12, false),
    role: str(b, 'role', 100, true)!,
    date, startTime, endTime, people,
    notes: str(b, 'notes', 1000, false),
  };
}

/** A filled "leave this empty" field means a robot filled the form: accept quietly and keep nothing. */
export function looksAutomated(body: Record<string, unknown> | null | undefined): boolean {
  const v = body?.website;
  return typeof v === 'string' && v.trim() !== '';
}

/** Why the page won't take another request right now, or null. */
export function floodRefusal(lastHour: number, sameEmailToday: number): string | null {
  if (lastHour >= MAX_PER_HOUR) return 'We’re receiving a lot of requests right now. Please try again in an hour, or call us.';
  if (sameEmailToday >= MAX_PER_EMAIL_PER_DAY) return 'We already have several requests from you today. We’ll be in touch, or call us.';
  return null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu 12 Nov" (with the year when it isn't `thisYear`). */
export function dayWords(d: string, thisYear?: string) {
  const x = new Date(`${d}T00:00:00Z`);
  const y = d.slice(0, 4);
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}${thisYear && y !== thisYear ? ` ${y}` : ''}`;
}

/** "2 × Barista, Thu 12 Nov 07:00–15:00" (an end before the start runs overnight). */
export function requestLine(r: { role: string; people: number; date: string; startTime: string; endTime: string }, thisYear?: string) {
  const who = r.people > 1 ? `${r.people} × ${r.role}` : r.role;
  const overnight = r.endTime < r.startTime ? ' (overnight)' : '';
  return `${who}, ${dayWords(r.date, thisYear)} ${r.startTime.slice(0, 5)}–${r.endTime.slice(0, 5)}${overnight}`;
}

/** "12 Smith St, Fitzroy VIC 3065" */
export function placeLine(r: { siteName?: string | null; address: string; suburb?: string | null; region?: string | null; postcode?: string | null }) {
  const tail = [r.suburb, [r.region, r.postcode].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  const where = [r.address, tail].filter(Boolean).join(', ');
  return r.siteName ? `${r.siteName}, ${where}` : where;
}

/**
 * The email to the business's owners and admins. Names the customer (a business) and what they asked for, with a
 * link to Allocations; the customer's notes stay in CROP.
 */
export function customerRequestEmail(r: CustomerRequestInput, appUrl: string) {
  const subject = `New request for staff: ${r.businessName}`;
  const lines = [
    `${r.businessName} asked for staff through your request page.`,
    '',
    requestLine(r),
    placeLine(r),
    `${r.frequency === 'repeat' ? 'They expect to order again.' : 'A one-off request.'}`,
    `Contact: ${r.contactName}`,
    '',
    'Nothing is booked yet. Accept it to make them a client, then take the order as usual, or decline it.',
  ];
  if (appUrl) lines.push('', `${appUrl.replace(/\/$/, '')}/allocations?view=customers`);
  return { subject, body: lines.join('\n') };
}

/** Why a request can't be decided, or null. */
export function decideRefusal(status: RequestStatus): string | null {
  if (status === 'accepted') return 'This request has already been accepted';
  if (status === 'declined') return 'This request has already been declined';
  return null;
}

/**
 * Why an order can't be taken from this request (migration 0091), or null: only an accepted request, for the client
 * it was accepted for, and only once.
 */
export function requestOrderRefusal(
  r: { status: RequestStatus; clientId: string | null; orderId: string | null } | undefined,
  clientId: string,
): string | null {
  if (!r) return 'Request not found';
  if (r.status === 'new') return 'Accept this request before taking the order';
  if (r.status === 'declined') return 'This request was declined';
  if (r.orderId) return 'The order for this request has already been taken';
  if (r.clientId !== clientId) return 'This request was accepted for another {client}';
  return null;
}
