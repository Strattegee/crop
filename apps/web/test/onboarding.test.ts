import { describe, expect, it } from 'vitest';
import { checklistOption, forRolesLine, parseRoles, suggestedChecklist } from '../lib/onboarding';

const c = (id: string, forRoles?: string[]) => ({ id, name: id, forRoles });
const lists = [c('Anyone', []), c('Bar', ['Bartender']), c('Bar and floor', ['Bartender', 'Waiter']), c('Kitchen', ['Chef'])];

describe('onboarding checklists by role', () => {
  it('suggests the checklist for the most of the person’s roles, else one for anyone, else none', () => {
    expect(suggestedChecklist(lists, ['Chef'])?.id).toBe('Kitchen');
    expect(suggestedChecklist(lists, ['Bartender'])?.id).toBe('Bar');
    expect(suggestedChecklist(lists, ['Waiter', 'Bartender'])?.id).toBe('Bar and floor');
    expect(suggestedChecklist(lists, ['Barista'])?.id).toBe('Anyone');
    expect(suggestedChecklist(lists, ['chef'])?.id).toBe('Anyone');
    expect(suggestedChecklist(lists.slice(1), ['Barista'])).toBeNull();
    // Checklists from before roles existed count as for anyone.
    expect(suggestedChecklist([c('Old')], ['Chef'])?.id).toBe('Old');
  });
  it('words the roles a checklist is for', () => {
    expect(checklistOption(lists[0])).toBe('Anyone');
    expect(checklistOption(lists[2])).toBe('Bar and floor (for Bartender and Waiter)');
    expect(forRolesLine([])).toBe('For anyone');
    expect(forRolesLine(['Chef', 'Kitchen hand', 'Cook'])).toBe('For Chef, Kitchen hand and Cook');
    expect(parseRoles(' Chef, Kitchen hand ,,Chef')).toEqual(['Chef', 'Kitchen hand']);
    expect(parseRoles(undefined)).toEqual([]);
  });
});
