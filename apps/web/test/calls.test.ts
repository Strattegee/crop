import { describe, expect, it } from 'vitest';
import { CALL_OUTCOMES, callLine, callWith } from '../lib/calls';
import { cancelKindChoices } from '../lib/cancel-kinds';

describe('call log wording (David, 3 Nov)', () => {
  it('says who the call was with', () => {
    expect(callWith({ workerName: 'Sam Example', contactName: null, clientName: null })).toBe('Sam Example');
    expect(callWith({ workerName: null, contactName: 'Pat Ward', clientName: 'Bayside Health' })).toBe('Pat Ward (Bayside Health)');
    expect(callWith({ workerName: null, contactName: null, clientName: 'Bayside Health' })).toBe('Bayside Health');
  });

  it('words a call in one line, with the date when it was another day', () => {
    const c = { outcome: 'said_yes' as const, direction: 'out' as const, note: 'Back Monday', userName: 'Jo Allocator', localDate: '2026-11-03', localTime: '14:05' };
    expect(callLine(c, '2026-11-03')).toBe('Said yes · 14:05 by Jo Allocator · Back Monday');
    expect(callLine({ ...c, note: null, direction: 'in', outcome: 'no_answer' }, '2026-11-04')).toBe('No answer (they rang) · 03/11 14:05 by Jo Allocator');
    expect(CALL_OUTCOMES[0]).toBe('said_yes');
  });

  it('puts the client’s cancel reasons first for a client’s shift, in the business’s words', () => {
    expect(cancelKindChoices('Customer', true).map(k => k.label)).toEqual([
      'The customer cancelled', 'The customer withdrew the request', 'We couldn’t fill it', 'Our mistake', 'Other']);
    expect(cancelKindChoices('Client', false)[0]).toEqual({ value: 'other', label: 'Other' });
  });
});
