import { describe, expect, it } from 'vitest';
import { shiftItemChoices } from '../app/(office)/roster/view';

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
