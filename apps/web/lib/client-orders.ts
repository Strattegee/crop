/**
 * Client orders and the allocation screen (David, 2 Nov 2026). Pure helpers for the Allocations page: where an order
 * can go ("Client · Site · Area" choices), client shifts grouped by day with their stage, the link to fill a shift on
 * the roster, and whether the menu shows Allocations.
 */
import { mondayOf } from '../app/(office)/roster/view';

export type Stage = 'open' | 'offered' | 'assigned' | 'worker_to_confirm' | 'client_to_confirm' | 'booked';
/**
 * Stages in the roster's order. When a client confirms each booking, both sides must say yes (David, 2 Nov):
 * "worker to confirm" (the client is happy, the person hasn't confirmed) and "client to confirm" (the person confirmed,
 * the client hasn't) sit between allocated and booked.
 */
export const STAGES: readonly Stage[] = ['open', 'offered', 'assigned', 'worker_to_confirm', 'client_to_confirm', 'booked'];
/** Roster stage words and card classes (Steve's colours, 26 Oct). Use `stageLabel` for the business's word for client. */
export const STAGE: Record<Stage, { label: string; cls: string }> = {
  open: { label: 'Unfilled', cls: 'unfilled' },
  offered: { label: 'Offered', cls: 'offered' },
  assigned: { label: 'Allocated', cls: 'allocated' },
  worker_to_confirm: { label: 'Worker to confirm', cls: 'allocated' },
  client_to_confirm: { label: 'Client to confirm', cls: 'to-confirm' },
  booked: { label: 'Booked', cls: 'booked' },
};

/** A stage's words, with the business's words for client and worker: "Customer to confirm", "Employee to confirm". */
export function stageLabel(stage: Stage, client = 'Client', worker = 'Worker'): string {
  if (stage === 'client_to_confirm') return `${client} to confirm`;
  if (stage === 'worker_to_confirm') return `${worker} to confirm`;
  return STAGE[stage].label;
}

/** Whether the office can record the client's yes on this shift now (someone on it, client confirms, not yet said yes). */
export const canRecordClientYes = (s: { stage: Stage; clientConfirms?: boolean }) =>
  s.stage === 'client_to_confirm' || (s.stage === 'assigned' && Boolean(s.clientConfirms));

/** Client rank (1 = most loyal … 7 = fill-in) as a chip: "Rank 1"; nothing when not ranked. */
export function rankChip(rank: number | null | undefined): string | null {
  return rank && rank >= 1 && rank <= 7 ? `Rank ${rank}` : null;
}

/** The ranks for the client set-up's choice, with what the ends mean. */
export const RANK_CHOICES: { value: string; label: string }[] = [
  { value: '', label: 'Not ranked' },
  ...[1, 2, 3, 4, 5, 6, 7].map(n => ({ value: String(n), label: n === 1 ? '1 (most loyal)' : n === 7 ? '7 (fill-in, last option)' : String(n) })),
];

/**
 * The shift panel's line when the shift's client confirms each booking and someone is on it, or null. Both sides must
 * say yes, in either order (David, 2 Nov): `waiting` = the client's yes is still to record (button "Client confirmed"),
 * otherwise the line says who recorded it (button Undo).
 */
export function clientConfirmLine(
  s: { status: string; workerName?: string | null; clientConfirms?: boolean; clientConfirmedAt?: string | null; clientConfirmedBy?: string | null },
  client: string, when: (iso: string) => string,
): { waiting: boolean; text: string } | null {
  if (!s.clientConfirms || (s.status !== 'booked' && s.status !== 'assigned')) return null;
  const who = s.workerName ?? 'this person';
  if (!s.clientConfirmedAt) {
    return s.status === 'booked'
      ? { waiting: true, text: `Not final yet: waiting for the ${client} to confirm ${who}. Record it when they say yes; if they say no, remove the person.` }
      : { waiting: true, text: `The ${client} confirms each booking. Record their yes when they're happy with ${who}; it's final once both have confirmed.` };
  }
  const recorded = `The ${client} confirmed ${s.status === 'booked' ? '' : `${who} `}`.trimEnd() + `${s.clientConfirmedBy ? `, recorded by ${s.clientConfirmedBy}` : ''} ${when(s.clientConfirmedAt)}.`;
  return { waiting: false, text: s.status === 'booked' ? recorded : `${recorded} Waiting for ${who} to confirm; it's final when they do.` };
}

export const CHANNELS = [
  { value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }, { value: 'portal', label: 'Portal' }, { value: 'other', label: 'Other' },
] as const;

type Site = { id: string; name: string; clientId: string | null; clientName: string | null; active: boolean; areas?: { id: string; name: string; active: boolean }[] };
export type PlaceGroup = { clientName: string; options: { value: string; label: string }[] };

/**
 * Where an order can go: active sites that belong to a client, grouped by client, each site then its active areas.
 * The value carries client, site and area (`clientId|facilityId|areaId`, area blank for the whole site).
 */
export function orderPlaces(sites: Site[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  for (const s of [...sites].filter(x => x.active && x.clientId).sort(byName)) {
    const g = groups.get(s.clientId!) ?? { clientName: s.clientName ?? '', options: [] };
    g.options.push({ value: `${s.clientId}|${s.id}|`, label: `${g.clientName} · ${s.name}` });
    for (const a of (s.areas ?? []).filter(x => x.active).sort(byName)) g.options.push({ value: `${s.clientId}|${s.id}|${a.id}`, label: `${g.clientName} · ${s.name} · ${a.name}` });
    groups.set(s.clientId!, g);
  }
  return [...groups.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
}

/** Reads a place choice back: `{clientId, facilityId, areaId?}`, or null when it isn't one. */
export function parsePlace(v: string | undefined): { clientId: string; facilityId: string; areaId?: string } | null {
  const [clientId, facilityId, areaId] = (v ?? '').split('|');
  if (!clientId || !facilityId) return null;
  return { clientId, facilityId, ...(areaId ? { areaId } : {}) };
}

/** The roster with this shift's panel open, where the office sees ranked candidates, offers and assigns. */
export function findStaffHref(s: { id: string; facilityId: string; localDate: string }): string {
  return `/roster?week=${mondayOf(s.localDate)}&site=${s.facilityId}&shift=${s.id}#shift-panel`;
}

/** Shifts grouped by their local date, in the order given (soonest first). */
export function byDay<S extends { localDate: string }>(shifts: S[]): { date: string; label: string; shifts: S[] }[] {
  const out: { date: string; label: string; shifts: S[] }[] = [];
  for (const s of shifts) {
    let g = out.find(x => x.date === s.localDate);
    if (!g) {
      g = { date: s.localDate, label: dayLabel(s.localDate), shifts: [] };
      out.push(g);
    }
    g.shifts.push(s);
  }
  return out;
}

/** "Tuesday 10 November". */
export const dayLabel = (d: string) =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)).replace(',', '');

/**
 * Allocations in the menu: for a business that supplies employers on CROP, has clients, or takes requests from new
 * customers (migration 0089); the count is what's still to fill plus new customers' requests waiting.
 */
export type AllocationSummary = { agencyLinks: number; open: number; hasClients?: boolean; clientShiftsOpen?: number; customerRequests?: number; customerPage?: boolean };
export function allocationsMenu(s: AllocationSummary | null): { show: boolean; count: number } {
  if (!s) return { show: false, count: 0 };
  const customers = hasCustomers(s);
  const show = s.agencyLinks > 0 || Boolean(s.hasClients) || customers;
  return { show, count: show ? (s.agencyLinks > 0 ? s.open : 0) + (s.hasClients ? s.clientShiftsOpen ?? 0 : 0) + (s.customerRequests ?? 0) : 0 };
}

/** Whether Allocations has the "New customers" view: the request page is on or requests are waiting. */
export const hasCustomers = (s: Pick<AllocationSummary, 'customerRequests' | 'customerPage'> | null) =>
  Boolean(s?.customerPage) || (s?.customerRequests ?? 0) > 0;

/** Who asked, how and their reference, for a shift's line: "Pat Ward · Email · ref PO-77". */
export function askedLine(s: { requestedByName?: string | null; orderChannel?: string | null; clientReference?: string | null }): string {
  const how = CHANNELS.find(c => c.value === s.orderChannel)?.label;
  return [s.requestedByName, how, s.clientReference ? `ref ${s.clientReference}` : null].filter(Boolean).join(' · ');
}

/** "2 booked emails sent · 1 change email" for an order's line in Completed and history. */
export function sentLine(booked: number, changes: number): string {
  const parts: string[] = [];
  if (booked > 0) parts.push(`${booked} booked ${booked === 1 ? 'email' : 'emails'} sent`);
  if (changes > 0) parts.push(`${changes} change ${changes === 1 ? 'email' : 'emails'} sent`);
  return parts.join(' · ');
}

/** A saved client contact (migration 0072): the client's people who order shifts. */
export type ClientContact = {
  id: string; clientId: string; clientName?: string; name: string; position: string | null; email: string | null; phone: string | null;
  notes?: string | null; active?: boolean;
};

/** The live contacts of the client in a place choice (`clientId|siteId|areaId`), by name; none until a place is chosen. */
export function contactsFor(contacts: ClientContact[], placeValue: string | undefined): ClientContact[] {
  const clientId = parsePlace(placeValue)?.clientId;
  if (!clientId) return [];
  return contacts.filter(c => c.clientId === clientId && c.active !== false).sort((a, b) => a.name.localeCompare(b.name));
}

/** A contact as one line in a list or choice: "Jo Bloggs (Nurse unit manager) · jo@… · 0400 …". */
export function contactLine(c: Pick<ClientContact, 'name' | 'position' | 'email' | 'phone'>, withDetails = true): string {
  const head = c.position ? `${c.name} (${c.position})` : c.name;
  return withDetails ? [head, c.email, c.phone].filter(Boolean).join(' · ') : head;
}

/** What the order's "saved" message adds about who asked. */
export function contactSavedNote(saved: boolean, name: string | undefined, client: string): string {
  return saved && name ? ` ${name} is saved as a contact for this ${client}.` : '';
}
