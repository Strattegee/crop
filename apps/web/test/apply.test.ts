import { describe, expect, it } from 'vitest';
import { answersFromForm, applySummary, applyUrl, choicesFromText, filesFrom, keptValues, regionsFor, type CustomQuestion } from '../lib/apply';

const custom: CustomQuestion[] = [
  { id: 'qweekend', label: 'Weekends?', help: null, type: 'yes_no', required: true, choices: [] },
  { id: 'qshifts', label: 'Which shifts?', help: null, type: 'multi_choice', required: false, choices: ['Early', 'Late'] },
  { id: 'qticket', label: 'Ticket', help: null, type: 'file', required: false, choices: [] },
];

function form(entries: [string, string | File][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe('applying online (web helpers)', () => {
  it('turns the form’s fields into the answers the API reads', () => {
    const f = form([
      ['firstName', 'Sam'], ['lastName', 'Example'], ['email', 'sam@example.com'], ['mobile', ''], ['roles', 'Barista'], ['roles', 'Cook'],
      ['workTypes', 'casual'], ['avail_1', 'am'], ['avail_1', 'pm'], ['avail_7', 'night'], ['credentials', 'c1'], ['rightToWork', 'yes'],
      ['rightToWorkStatus', 'citizen'], ['consent', 'yes'], ['c_qweekend', 'yes'], ['c_qshifts', 'Late'], ['formToken', 'abc'],
    ]);
    const a = answersFromForm(f, custom);
    expect(a).toMatchObject({
      firstName: 'Sam', email: 'sam@example.com', roles: ['Barista', 'Cook'], workTypes: ['casual'], credentials: ['c1'], consent: true,
      rightToWork: 'yes', custom: { qweekend: 'yes', qshifts: ['Late'] },
    });
    expect(a).not.toHaveProperty('mobile');
    expect((a.availability as { weekday: number; periods: string[] }[])[0]).toEqual({ weekday: 1, periods: ['am', 'pm'] });
    expect((a.availability as { weekday: number; periods: string[] }[])[6]).toEqual({ weekday: 7, periods: ['night'] });
    expect(answersFromForm(form([]), custom).consent).toBe(false);
  });

  it('sends only the files the API takes and keeps typed answers for a second try', () => {
    const pdf = new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' });
    const empty = new File([], '', { type: 'application/octet-stream' });
    const f = form([['cv', pdf], ['cred_123e4567-e89b-12d3-a456-426614174000', pdf], ['q_qticket', empty], ['sneaky', pdf], ['firstName', 'Sam'], ['formToken', 'x'], ['website', '']]);
    expect(filesFrom(f.entries()).map(x => x.field)).toEqual(['cv', 'cred_123e4567-e89b-12d3-a456-426614174000']);
    expect(keptValues(f.entries())).toEqual({ firstName: ['Sam'] });
  });

  it('words the settings page', () => {
    expect(applyUrl('https://staging.cropwms.com/', 'cfy')).toBe('https://staging.cropwms.com/apply/cfy');
    expect(choicesFromText('Early\n\n Late \r\nEarly')).toEqual(['Early', 'Late']);
    expect(regionsFor('AU')).toContain('VIC');
    expect(regionsFor('NZ')).toBeNull();
    expect(applySummary(0, 2)).toBe('None waiting for an email to be confirmed · 2 confirmed in the last 30 days');
    expect(applySummary(3, 0)).toBe('3 waiting for the applicant to confirm their email · 0 confirmed in the last 30 days');
  });
});
