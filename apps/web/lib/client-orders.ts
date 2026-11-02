/**
 * Client orders and the allocation screen (David, 2 Nov 2026). Pure helpers for the Allocations page: where an order
 * can go ("Client · Site · Area" choices), client shifts grouped by day with their stage, the link to fill a shift on
 * the roster, and whether the menu shows Allocations.
 */
import { mondayOf } from '../app/(office)/roster/view';

export type Stage = 'open' | 'offered' | 'assigned' | 'client_to_confirm' | 'booked';
/** Stages in the roster's order; "client to confirm" (migration 0069) sits between allocated and booked. */
export const STAGES: readonly Stage[] = ['open', 'offered', 'assigned', 'client_to_confirm', 'booked'];
/** Roster stage words and card classes (Steve's colours, 26 Oct). Use `stageLabel` for the business's word for client. */
export const STAGE: Record<Stage, { label: string; cls: string }> = {
  open: { label: 'Unfilled', cls: 'unfilled' },
  offered: { label: 'Offered', cls: 'offered' },
  assigned: { label: 'Allocated', cls: 'allocated' },
  client_to_confirm: { label: 'Client to confirm', cls: 'to-confirm' },
  booked: { label: 'Booked', cls: 'booked' },
};

/** A stage's words, with the business's word for client: "Customer to confirm". */
export function stageLabel(stage: Stage, client = 'Client'): string {
  return stage === 'client_to_confirm' ? `${client} to confirm` : STAGE[stage].label;
}

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
 * The shift panel's line for a booked shift on an order whose client confirms each booking, or null:
 * "Waiting for Bayside Health to confirm Sarah Example" / "Bayside Health confirmed (Pat at the office, Mon 2 Nov 10:15)".
 */
export function clientConfirmLine(
  s: { status: string; workerName?: string | null; clientConfirms?: boolean; clientConfirmedAt?: string | null; clientConfirmedBy?: string | null },
  client: string, when: (iso: string) => string,
): { waiting: boolean; text: string } | null {
  if (!s.clientConfirms || s.status !== 'booked') return null;
  if (!s.clientConfirmedAt) return { waiting: true, text: `Waiting for the ${client} to confirm ${s.workerName ?? 'this booking'}. Record it when they say yes; if they say no, remove the person.` };
  return { waiting: false, text: `The ${client} confirmed${s.clientConfirmedBy ? `, recorded by ${s.clientConfirmedBy}` : ''} ${when(s.clientConfirmedAt)}.` };
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

/** Allocations in the menu: for a business that supplies employers on CROP or has clients; the count is what's still to fill. */
export function allocationsMenu(s: { agencyLinks: number; open: number; hasClients?: boolean; clientShiftsOpen?: number } | null): { show: boolean; count: number } {
  if (!s) return { show: false, count: 0 };
  const show = s.agencyLinks > 0 || Boolean(s.hasClients);
  return { show, count: show ? (s.agencyLinks > 0 ? s.open : 0) + (s.hasClients ? s.clientShiftsOpen ?? 0 : 0) : 0 };
}

/** Who asked, how and their reference, for a shift's line: "Pat Ward · Email · ref PO-77". */
export function askedLine(s: { requestedByName?: string | null; orderChannel?: string | null; clientReference?: string | null }): string {
  const how = CHANNELS.find(c => c.value === s.orderChannel)?.label;
  return [s.requestedByName, how, s.clientReference ? `ref ${s.clientReference}` : null].filter(Boolean).join(' · ');
}
