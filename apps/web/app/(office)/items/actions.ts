'use server';

import { api } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';

const cents = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v === undefined) return undefined;
  const n = Number(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const qty = (f: FormData, k = 'quantity') => Number(str(f, k) ?? 'NaN');

export async function addItem(f: FormData) {
  await attempt('/items', () => api('/items', { method: 'POST', body: {
    name: str(f, 'name'), category: str(f, 'category'), unit: str(f, 'unit') ?? 'each', unitCostCents: cents(f, 'unitCost') ?? 0,
    chargeCents: cents(f, 'charge') ?? null, tracksStock: f.get('tracksStock') === 'on', reorderLevel: str(f, 'reorderLevel') ? qty(f, 'reorderLevel') : null,
  } }), 'Item added.');
}

export async function receive(id: string, f: FormData) {
  await attempt('/items', () => api(`/items/${id}/receive`, { method: 'POST', body: { facilityId: str(f, 'facilityId'), quantity: qty(f), unitCostCents: cents(f, 'unitCost') ?? null, notes: str(f, 'notes') } }), 'Stock received.');
}

export async function issue(id: string, f: FormData) {
  await attempt('/items', () => api(`/items/${id}/issue`, { method: 'POST', body: { workerId: str(f, 'workerId'), facilityId: str(f, 'facilityId'), quantity: qty(f), notes: str(f, 'notes') } }), 'Issued.');
}

export async function count(id: string, f: FormData) {
  await attempt('/items', () => api(`/items/${id}/count`, { method: 'POST', body: { facilityId: str(f, 'facilityId'), quantity: qty(f), notes: str(f, 'notes') } }), 'Stocktake recorded.');
}
