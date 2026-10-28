/** Items and consumables (backlog item 5): pure rules for stock, returns and costs. Unit-tested in test/items.spec.ts. */

export const ITEM_CATEGORIES = ['ppe', 'fuel', 'sundries', 'tools', 'other'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export type MovementKind = 'received' | 'issued' | 'used' | 'returned' | 'adjusted' | 'transferred';

/** Quantities are kept to 3 decimal places (litres of fuel, metres of tape). */
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

/** "3", "2.5", "0.125": no trailing zeros. */
export const formatQty = (n: number) => String(roundQty(n));

/** Wording that needs no plurals: "3 × Safety gloves (pair)". */
export const describeQty = (qty: number, name: string, unit: string) => `${formatQty(qty)} × ${name} (${unit})`;

/** Cost or charge in cents for a quantity at a unit price, rounded to the cent. */
export const lineCents = (qty: number, unitCents: number) => Math.round(Math.abs(qty) * unitCents);

export interface TakeInput {
  itemName: string;
  unit: string;
  tracksStock: boolean;
  /** On hand at the site the stock comes from (ignored when stock isn't tracked). */
  onHand: number;
  siteName: string | null;
  quantity: number;
}

/** Why stock can't be taken from a site, or null when it can. Untracked items never block. */
export function takeBlock(t: TakeInput): string | null {
  if (!t.tracksStock) return null;
  if (!t.siteName) return 'Choose the site the stock comes from';
  if (roundQty(t.onHand) < roundQty(t.quantity)) {
    return t.onHand <= 0
      ? `There are no ${t.itemName} (${t.unit}) on hand at ${t.siteName}`
      : `Only ${describeQty(t.onHand, t.itemName, t.unit)} on hand at ${t.siteName}`;
  }
  return null;
}

/** Why stock can't be moved between two sites, or null. The amount on hand is checked with `takeBlock`. */
export function transferBlock(t: { itemName: string; tracksStock: boolean; fromId: string; toId: string }): string | null {
  if (!t.tracksStock) return `Stock isn't counted for ${t.itemName}, so there is nothing to move`;
  if (t.fromId === t.toId) return 'Choose two different sites';
  return null;
}

/** Why a return can't be recorded, or null. Can't return more than was issued to that person or used on that shift. */
export function returnBlock(outstanding: number, quantity: number, itemName: string, who: string): string | null {
  if (roundQty(outstanding) <= 0) return `No ${itemName} are out with ${who}`;
  if (roundQty(quantity) > roundQty(outstanding)) return `Only ${formatQty(outstanding)} ${itemName} are out with ${who}`;
  return null;
}

export interface MovementLine {
  itemId: string;
  name: string;
  unit: string;
  /** Signed, as stored: negative when it went out. */
  quantity: number;
  unitCostCents: number;
  chargeCents: number | null;
  /** Who it was issued to (null when used on the shift itself); only read when splitting by person. */
  workerId?: string | null;
  workerName?: string | null;
}

export interface UsageLine {
  itemId: string;
  name: string;
  unit: string;
  /** Net quantity out (issued or used, less returns). */
  quantity: number;
  costCents: number;
  /** Null when the item isn't charged to the client. */
  chargeCents: number | null;
  /** With `byPerson`: who holds it (null = used on the shift itself), so a return can say where it comes from. */
  workerId?: string | null;
  workerName?: string | null;
}

/**
 * Net use per item from a shift's (or person's) movements: issues and uses count, returns take them back.
 * Each movement keeps the cost and charge it was recorded with, so price changes don't rewrite history.
 */
export function summariseUsage(lines: MovementLine[], opts: { byPerson?: boolean } = {}): { lines: UsageLine[]; totalCostCents: number; totalChargeCents: number } {
  const byItem = new Map<string, UsageLine>();
  for (const m of lines) {
    const key = opts.byPerson ? `${m.itemId}:${m.workerId ?? ''}` : m.itemId;
    const u = byItem.get(key) ?? {
      itemId: m.itemId, name: m.name, unit: m.unit, quantity: 0, costCents: 0, chargeCents: null,
      ...(opts.byPerson ? { workerId: m.workerId ?? null, workerName: m.workerName ?? null } : {}),
    };
    const sign = m.quantity < 0 ? 1 : -1; // going out adds to use, coming back takes it away
    u.quantity = roundQty(u.quantity - m.quantity);
    u.costCents += sign * lineCents(m.quantity, m.unitCostCents);
    if (m.chargeCents !== null) u.chargeCents = (u.chargeCents ?? 0) + sign * lineCents(m.quantity, m.chargeCents);
    byItem.set(key, u);
  }
  const out = [...byItem.values()].filter(u => u.quantity !== 0 || u.costCents !== 0).sort((a, b) => a.name.localeCompare(b.name) || (a.workerName ?? '').localeCompare(b.workerName ?? ''));
  return {
    lines: out,
    totalCostCents: out.reduce((s, u) => s + u.costCents, 0),
    totalChargeCents: out.reduce((s, u) => s + (u.chargeCents ?? 0), 0),
  };
}

/** Low when a reorder level is set and on hand is at or below it. */
export const isLow = (onHand: number, reorderLevel: number | null) => reorderLevel !== null && roundQty(onHand) <= roundQty(reorderLevel);
