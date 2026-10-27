import { describe, expect, it } from 'vitest';
import { detailLines, parseLook, simpleLine } from '../app/(office)/roster/view';

const shift = {
  role: 'Barista', areaName: 'Front counter', facilityName: 'The Grand Cafe', hours: 7.5, workerName: 'Sam Example',
  status: 'booked', notes: null as string | null, cancelledReason: null, pulledOutName: null, equipmentOnly: false,
};

describe('roster card looks', () => {
  it('reads the look from the address, falling back to cards', () => {
    expect(parseLook('detailed')).toBe('detailed');
    expect(parseLook('simple')).toBe('simple');
    expect(parseLook(undefined)).toBe('cards');
    expect(parseLook('huge')).toBe('cards');
  });

  it('detailed cards add the role, hours and notes without repeating the row', () => {
    expect(detailLines({ ...shift, notes: ' Bring keys ' }, 'open', 'area')).toEqual(['Barista', '7.5 hours', 'Bring keys']);
    // A person's row already names them; by person the area is worth saying.
    expect(detailLines(shift, 'person', 'person')).toEqual(['Front counter', '7.5 hours']);
    expect(detailLines({ ...shift, workerName: null, hours: 1, pulledOutName: 'Alex Example', status: 'open' }, 'open', 'area'))
      .toEqual(['1 hour', 'Alex Example pulled out']);
    expect(detailLines({ ...shift, status: 'cancelled', cancelledReason: 'Site closed' }, 'cancelled', 'area'))
      .toEqual(['7.5 hours', 'Cancelled: Site closed']);
  });

  it('simple cards say who, else the role, and count equipment', () => {
    expect(simpleLine(shift, 'open')).toBe('Sam Example');
    expect(simpleLine({ ...shift, workerName: null }, 'open')).toBe('Barista');
    expect(simpleLine(shift, 'person')).toBe('Barista');
    expect(simpleLine({ ...shift, equipment: [{}, {}] }, 'equipment')).toBe('Sam Example +2');
  });
});
