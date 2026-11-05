/**
 * A stage's items (5 Nov, the last "still to do" but templates of project stages): the consumables a stage is
 * expected to use, e.g. Demolition: 40 pairs of gloves and 20 dust masks. Pure rules: what the stage has used so
 * far on its {shifts} (issued for or used on them, net of returns), what is still to go, and whether the project's
 * stock covers what every stage not yet finished still needs. Quantities only, never costs (supervisors see stages).
 */
import { formatQty, roundQty } from '../items/items.js';

export interface PlannedItem { id: string; stageId: string; itemId: string; name: string; unit: string; tracksStock: boolean; planned: number; note: string | null }
export interface UsedItem { stageId: string; itemId: string; name: string; unit: string; tracksStock: boolean; used: number }
export interface StageState { id: string; state: 'ended' | 'current' | 'upcoming' }

export interface StageItemLine {
  /** The planned row (null = used on the stage's {shifts} without being planned). */
  id: string | null;
  itemId: string; name: string; unit: string; tracksStock: boolean;
  planned: number | null; used: number; toGo: number; note: string | null;
  line: string;
  /** The project's stock doesn't cover what the stages not yet finished still need of this item. */
  short: { need: number; onHand: number } | null;
}
export interface ItemShortage { itemId: string; name: string; unit: string; need: number; onHand: number; line: string }

const q = (n: number, unit: string) => `${formatQty(n)} ${unit}`;

/** "40 planned · 12 used · 28 to go", "40 planned · 45 used (5 over)", "12 used, not planned". */
export function itemLine(l: { planned: number | null; used: number; unit: string }): string {
  if (l.planned === null) return `${q(l.used, l.unit)} used, not planned`;
  const used = roundQty(l.used);
  if (used <= 0) return `${q(l.planned, l.unit)} planned · none used yet`;
  const left = roundQty(l.planned - used);
  if (left > 0) return `${q(l.planned, l.unit)} planned · ${formatQty(used)} used · ${formatQty(left)} to go`;
  if (left === 0) return `${q(l.planned, l.unit)} planned · all used`;
  return `${q(l.planned, l.unit)} planned · ${formatQty(used)} used (${formatQty(-left)} over)`;
}

/**
 * Each stage's item lines (planned first in the order given, then items used without a plan, by name) and the
 * project's shortages: for counted items, the sum of what stages not yet finished still have to go, against what the
 * project has on hand. Finished stages never count towards a shortage.
 */
export function stageItemLines(stages: StageState[], planned: PlannedItem[], used: UsedItem[], onHand: Map<string, number>):
  { byStage: Map<string, StageItemLine[]>; shortages: ItemShortage[] } {
  const usedOf = new Map(used.map(u => [`${u.stageId}:${u.itemId}`, u]));
  const byStage = new Map<string, StageItemLine[]>(stages.map(s => [s.id, []]));
  const ended = new Set(stages.filter(s => s.state === 'ended').map(s => s.id));
  const need = new Map<string, { name: string; unit: string; need: number }>();
  for (const p of planned) {
    const list = byStage.get(p.stageId);
    if (!list) continue;
    const u = roundQty(usedOf.get(`${p.stageId}:${p.itemId}`)?.used ?? 0);
    const toGo = Math.max(roundQty(p.planned - u), 0);
    list.push({ id: p.id, itemId: p.itemId, name: p.name, unit: p.unit, tracksStock: p.tracksStock, planned: p.planned, used: u, toGo, note: p.note,
      line: itemLine({ planned: p.planned, used: u, unit: p.unit }), short: null });
    if (p.tracksStock && !ended.has(p.stageId) && toGo > 0) {
      const n = need.get(p.itemId) ?? { name: p.name, unit: p.unit, need: 0 };
      n.need = roundQty(n.need + toGo);
      need.set(p.itemId, n);
    }
  }
  const plannedKeys = new Set(planned.map(p => `${p.stageId}:${p.itemId}`));
  for (const u of [...used].sort((a, b) => a.name.localeCompare(b.name))) {
    const list = byStage.get(u.stageId);
    if (!list || plannedKeys.has(`${u.stageId}:${u.itemId}`) || roundQty(u.used) <= 0) continue;
    list.push({ id: null, itemId: u.itemId, name: u.name, unit: u.unit, tracksStock: u.tracksStock, planned: null, used: roundQty(u.used), toGo: 0, note: null,
      line: itemLine({ planned: null, used: u.used, unit: u.unit }), short: null });
  }
  const shortages: ItemShortage[] = [];
  for (const [itemId, n] of need) {
    const have = roundQty(onHand.get(itemId) ?? 0);
    if (have >= n.need) continue;
    shortages.push({ itemId, name: n.name, unit: n.unit, need: n.need, onHand: have, line: shortLine(n.name, n.unit, n.need, have) });
    for (const [stageId, list] of byStage) {
      if (ended.has(stageId)) continue;
      for (const l of list) if (l.itemId === itemId && l.toGo > 0) l.short = { need: n.need, onHand: have };
    }
  }
  shortages.sort((a, b) => a.name.localeCompare(b.name));
  return { byStage, shortages };
}

/** "Gloves: stages still need 28 pair, 10 on hand here". */
export function shortLine(name: string, unit: string, need: number, onHand: number): string {
  return `${name}: stages still need ${q(need, unit)}, ${onHand > 0 ? `${formatQty(onHand)} on hand here` : 'none on hand here'}`;
}

/** A planned quantity from a request: more than 0, at most 1,000,000, up to 3 decimals. */
export function plannedQuantity(v: unknown): number | { problem: string } {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || roundQty(n) <= 0) return { problem: 'Enter how many the stage needs (more than 0)' };
  if (n > 1_000_000) return { problem: 'That quantity is too large' };
  return roundQty(n);
}
