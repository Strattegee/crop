import { describe, expect, it } from 'vitest';
import { formatQty, isLow, lineCents, returnBlock, summariseUsage, takeBlock, transferBlock, type MovementLine } from '../src/items/items.js';

const take = { itemName: 'Safety gloves', unit: 'pair', tracksStock: true, onHand: 3, siteName: 'North Yard', quantity: 2 };
const line = (over: Partial<MovementLine>): MovementLine =>
  ({ itemId: 'g', name: 'Safety gloves', unit: 'pair', quantity: -1, unitCostCents: 450, chargeCents: null, ...over });

describe('items and consumables', () => {
  it('formats quantities and rounds costs to the cent', () => {
    expect(formatQty(2.5)).toBe('2.5');
    expect(formatQty(0.1 + 0.2)).toBe('0.3');
    expect(lineCents(-12.345, 199)).toBe(2457);
    expect(lineCents(3, 450)).toBe(1350);
  });

  it('only moves counted stock between two different sites', () => {
    const t = { itemName: 'Safety gloves', tracksStock: true, fromId: 'a', toId: 'b' };
    expect(transferBlock(t)).toBeNull();
    expect(transferBlock({ ...t, toId: 'a' })).toBe('Choose two different sites');
    expect(transferBlock({ ...t, tracksStock: false })).toBe("Stock isn't counted for Safety gloves, so there is nothing to move");
  });

  it('refuses to take more than a site has, unless stock isn\'t counted', () => {
    expect(takeBlock(take)).toBeNull();
    expect(takeBlock({ ...take, quantity: 3 })).toBeNull();
    expect(takeBlock({ ...take, quantity: 4 })).toBe('Only 3 × Safety gloves (pair) on hand at North Yard');
    expect(takeBlock({ ...take, onHand: 0 })).toBe('There are no Safety gloves (pair) on hand at North Yard');
    expect(takeBlock({ ...take, siteName: null })).toBe('Choose the site the stock comes from');
    expect(takeBlock({ ...take, tracksStock: false, onHand: 0, siteName: null })).toBeNull();
    expect(takeBlock({ ...take, onHand: 0.1 + 0.2, quantity: 0.3 })).toBeNull(); // no floating-point surprises
  });

  it('only takes back what went out', () => {
    expect(returnBlock(2, 2, 'Safety gloves', 'Ana Example')).toBeNull();
    expect(returnBlock(2, 3, 'Safety gloves', 'Ana Example')).toBe('Only 2 Safety gloves are out with Ana Example');
    expect(returnBlock(0, 1, 'Safety gloves', 'this shift')).toBe('No Safety gloves are out with this shift');
  });

  it('nets use, cost and client charges per item, at the prices recorded', () => {
    const r = summariseUsage([
      line({ quantity: -2 }),
      line({ quantity: -1, unitCostCents: 500 }), // price went up
      line({ quantity: 1, unitCostCents: 500 }), // one returned
      line({ itemId: 'd', name: 'Diesel', unit: 'litre', quantity: -40.5, unitCostCents: 199, chargeCents: 250 }),
    ]);
    expect(r.lines).toEqual([
      { itemId: 'd', name: 'Diesel', unit: 'litre', quantity: 40.5, costCents: 8060, chargeCents: 10125 },
      { itemId: 'g', name: 'Safety gloves', unit: 'pair', quantity: 2, costCents: 900, chargeCents: null },
    ]);
    expect(r.totalCostCents).toBe(8960);
    expect(r.totalChargeCents).toBe(10125);
    expect(summariseUsage([line({ quantity: -1 }), line({ quantity: 1 })]).lines).toEqual([]);
  });

  it('can split use by who holds it', () => {
    const r = summariseUsage([
      line({ quantity: -2, workerId: 'ana', workerName: 'Ana Example' }),
      line({ quantity: -3 }),
      line({ quantity: 1, workerId: 'ana', workerName: 'Ana Example' }),
    ], { byPerson: true });
    expect(r.lines.map(l => [l.workerName, l.quantity])).toEqual([[null, 3], ['Ana Example', 1]]);
    expect(summariseUsage([line({ quantity: -2, workerId: 'ana' }), line({ quantity: -3 })]).lines).toHaveLength(1);
  });

  it('shows low stock at or below the reorder level', () => {
    expect(isLow(5, 5)).toBe(true);
    expect(isLow(6, 5)).toBe(false);
    expect(isLow(0, null)).toBe(false);
  });
});
