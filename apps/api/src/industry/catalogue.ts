/**
 * Which industries a thing belongs to (David, 31 Oct): credentials, roles, duties, equipment types, items and shift
 * types are grouped by industry, so each business sees the ones for the industries it works in. Worked out from the
 * industry templates (packs.ts), never stored: credentials by catalogue code (then name), everything else by name.
 * Something no template has is the business's own (an empty list).
 */
import { catalogueCode, PACKS } from './packs.js';

export type CatalogueKind = 'credential' | 'role' | 'duty' | 'equipmentType' | 'item' | 'shiftCode';

const key = (s: string) => s.trim().toLowerCase();

function build(): Record<CatalogueKind, Map<string, string[]>> {
  const idx: Record<CatalogueKind, Map<string, string[]>> = {
    credential: new Map(), role: new Map(), duty: new Map(), equipmentType: new Map(), item: new Map(), shiftCode: new Map(),
  };
  const add = (kind: CatalogueKind, k: string, pack: string) => {
    const list = idx[kind].get(k) ?? [];
    if (!list.includes(pack)) list.push(pack);
    idx[kind].set(k, list);
  };
  for (const p of PACKS) {
    for (const c of p.credentials) { add('credential', c.code, p.id); add('credential', key(c.name), p.id); }
    for (const r of p.roles) add('role', key(r.name), p.id);
    for (const d of p.duties) add('duty', key(d.name), p.id);
    for (const e of p.equipmentTypes) add('equipmentType', key(e.name), p.id);
    for (const i of p.items) add('item', key(i.name), p.id);
    for (const s of p.shiftCodes) add('shiftCode', key(s.code), p.id);
  }
  return idx;
}
const INDEX = build();

/** The industry templates (pack ids, in template order) that include this thing; [] = the business's own. */
export function industriesOf(kind: CatalogueKind, name: string, code?: string | null): string[] {
  const m = INDEX[kind];
  return (code && m.get(code)) || m.get(key(name)) || (kind === 'credential' ? m.get(catalogueCode(name)) : undefined) || [];
}
