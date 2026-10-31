import { describe, expect, it } from 'vitest';
import { industriesOf } from '../src/industry/catalogue.js';
import { catalogueCode, PACKS } from '../src/industry/packs.js';

describe('industry of each thing (David, 31 Oct)', () => {
  it('finds the templates a credential comes from, by code or name, shared ones in several', () => {
    const firstAid = industriesOf('credential', 'First Aid (HLTAID011)');
    expect(firstAid.length).toBeGreaterThan(1);
    expect(industriesOf('credential', 'anything', catalogueCode('First Aid (HLTAID011)'))).toEqual(firstAid);
    expect(industriesOf('credential', 'first aid (hltaid011)')).toEqual(firstAid);
    expect(industriesOf('credential', 'Our own induction')).toEqual([]);
  });
  it('keeps template order and covers every kind', () => {
    const order = PACKS.map(p => p.id);
    const firstAid = industriesOf('credential', 'First Aid (HLTAID011)');
    expect([...firstAid].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(firstAid);
    for (const p of PACKS) {
      for (const r of p.roles) expect(industriesOf('role', r.name)).toContain(p.id);
      for (const d of p.duties) expect(industriesOf('duty', d.name)).toContain(p.id);
      for (const e of p.equipmentTypes) expect(industriesOf('equipmentType', e.name)).toContain(p.id);
      for (const i of p.items) expect(industriesOf('item', i.name)).toContain(p.id);
    }
  });
});
