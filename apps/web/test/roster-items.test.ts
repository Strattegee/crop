import { describe, expect, it } from 'vitest';
import { itemDrop, itemDropMessage, shiftItemChoices, withShift } from '../app/(office)/roster/view';

describe('items in the shift panel', () => {
  const items = [
    { id: 'g', name: 'Safety gloves', unit: 'pair', tracksStock: true },
    { id: 'f', name: 'Fuel', unit: 'litre', tracksStock: false },
    { id: 'a', name: 'Aprons', unit: 'each', tracksStock: true },
  ];

  it('says how many the site has, and greys out counted items it has none of', () => {
    expect(shiftItemChoices(items, [{ itemId: 'g', onHand: 12.5 }])).toEqual([
      { id: 'f', label: 'Fuel (litre)', disabled: false },
      { id: 'g', label: 'Safety gloves (pair) · 12.5 here', disabled: false },
      { id: 'a', label: 'Aprons (each) · none here', disabled: true },
    ]);
  });

  it('treats a negative balance as none', () => {
    expect(shiftItemChoices([items[2]], [{ itemId: 'a', onHand: -1 }])[0].disabled).toBe(true);
  });
});

describe('dragging an item onto a shift', () => {
  it('gives one to the person on the shift, like the panel', () => {
    expect(itemDrop('w1', false)).toEqual({ workerId: 'w1', quantity: 1 });
  });

  it('records it as used on the shift when nobody is on it, or on equipment-only shifts', () => {
    expect(itemDrop(null, false)).toEqual({ workerId: null, quantity: 1 });
    expect(itemDrop('', false)).toEqual({ workerId: null, quantity: 1 });
    expect(itemDrop('w1', true)).toEqual({ workerId: null, quantity: 1 });
  });

  it('says what happened in the business words', () => {
    expect(itemDropMessage('Safety gloves', 'pair', 'Sam Example', 'job'))
      .toBe('Safety gloves (1 pair) given to Sam Example for this job. Change how many or return it under Items below.');
    expect(itemDropMessage('Fuel', 'litre', null, 'shift'))
      .toBe('Fuel (1 litre) recorded as used on this shift. Change how many or return it under Items below.');
  });

  it('comes back with the shift panel open and old messages dropped', () => {
    expect(withShift('/roster?week=2026-11-02&site=s1&done=Booked.', 'abc')).toBe('/roster?week=2026-11-02&site=s1&shift=abc');
    expect(withShift('/roster?week=2026-11-02&shift=old', 'new')).toBe('/roster?week=2026-11-02&shift=new');
    expect(withShift('/elsewhere', 'x')).toBe('/roster?shift=x');
  });
});
