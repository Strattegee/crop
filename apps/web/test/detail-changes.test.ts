import { describe, expect, it } from 'vitest';
import { changeLine, nowLine, type DetailChange } from '../lib/detail-changes';

const base: DetailChange = {
  id: 'c1', workerId: 'w1', workerName: 'Ana Example', field: 'mobile', action: null, label: 'Mobile', what: 'Change mobile',
  askedLine: '+61498765432', wasLine: '+61412345678', nowLine: null, status: 'pending', createdAt: '2026-11-04T00:00:00Z',
  decidedAt: null, decidedByName: null, decidedNote: null, canDecide: true,
};

describe('detail changes (David, 3 Nov, answer 5)', () => {
  it('shows mobiles the business’s way and says what changes', () => {
    expect(changeLine(base, 'AU')).toBe('From 0412 345 678 to 0498 765 432');
    expect(changeLine({ ...base, field: 'preferred_name', askedLine: 'Annie', wasLine: 'Not given' })).toBe('From Not given to Annie');
    expect(changeLine({ ...base, field: 'address', action: 'add', askedLine: '5 Sample Lane, Carlton VIC 3053', wasLine: null })).toBe('Add: 5 Sample Lane, Carlton VIC 3053');
    expect(changeLine({ ...base, field: 'address', action: 'remove', askedLine: '5 Sample Lane' })).toBe('Take off the list: 5 Sample Lane');
  });

  it('says when the office changed it since they asked', () => {
    expect(nowLine(base, 'AU')).toBeNull();
    expect(nowLine({ ...base, nowLine: '+61411111111' }, 'AU')).toBe('Changed since they asked: it’s 0411 111 111 now.');
  });
});
