import { describe, expect, it } from 'vitest';
import { auditValue, auditWho } from '../lib/audit';

describe('audit log wording', () => {
  const when = (iso: string) => `at ${iso.slice(0, 10)}`;
  it('shows values as people read them', () => {
    expect(auditValue(null, when)).toBe('—');
    expect(auditValue(true, when)).toBe('Yes');
    expect(auditValue(['Carer', 'Cook'], when)).toBe('Carer, Cook');
    expect(auditValue('2026-10-31T04:00:00Z', when)).toBe('at 2026-10-31');
    expect(auditValue('2026-10-31', when)).toBe('2026-10-31');
    expect(auditValue('7a101441-1454-4b8e-b360-5e526610d91c', when)).toBe('a record');
  });
  it('says who and how', () => {
    expect(auditWho('Ana', 'app')).toBe('Ana (in the app)');
    expect(auditWho('Someone using a link', 'link')).toBe('Someone using a link (by link)');
    expect(auditWho(null, 'office')).toBe('Someone');
  });
});
