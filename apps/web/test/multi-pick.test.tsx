import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  chosenItems, matchesSearch, noMatchLine, pickButtonLabel, pickGroups, removeLabel, shortFileName, toggle, upperFirst, visibleValues,
} from '../lib/multi-pick';
import { industryGroups } from '../lib/industry-groups';
import type { ApplyView } from '../lib/apply';

vi.mock('../app/apply/[slug]/actions', () => ({ sendApply: async () => ({ status: 'idle' }) }));
const { ApplyForm } = await import('../app/apply/[slug]/apply-form');
const { MultiPick } = await import('../app/apply/[slug]/multi-pick');

const groups = [
  { key: 'health', label: 'Healthcare', items: [{ value: 'Nurse', label: 'Registered nurse' }, { value: 'Carer', label: 'Personal care worker' }] },
  { key: 'labour', label: 'Labour hire', items: [{ value: 'Forklift', label: 'Forklift driver' }, { value: 'Crèche', label: 'Crèche assistant' }] },
];
const noun = { one: 'role', many: 'roles' };

describe('multi-pick helpers', () => {
  it('searches every word, ignoring case and accents, and the group name', () => {
    expect(matchesSearch('Registered nurse', '')).toBe(true);
    expect(matchesSearch('Registered nurse', 'NURSE reg')).toBe(true);
    expect(matchesSearch('Crèche assistant', 'creche')).toBe(true);
    expect(matchesSearch('Forklift driver', 'nurse')).toBe(false);
    expect(matchesSearch('Forklift driver', 'labour', 'Labour hire')).toBe(true);
    expect([...visibleValues(groups, 'driver')]).toEqual(['Forklift']);
    expect(visibleValues(groups, 'health').size).toBe(2);
  });
  it('keeps chosen items in list order, each once', () => {
    expect(chosenItems(groups, ['Forklift', 'Nurse', 'Nurse', 'gone']).map(i => i.value)).toEqual(['Nurse', 'Forklift']);
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('words the button, chips and files', () => {
    expect(pickButtonLabel(0, noun)).toBe('Choose roles');
    expect(pickButtonLabel(1, noun)).toBe('1 role chosen');
    expect(pickButtonLabel(3, noun)).toBe('3 roles chosen');
    expect(noMatchLine(' xyz ', noun)).toBe('No roles match “xyz”.');
    expect(removeLabel('Nurse')).toBe('Remove Nurse');
    expect(shortFileName('licence.pdf')).toBe('licence.pdf');
    const long = shortFileName('a-very-long-file-name-from-my-phone-camera.jpeg');
    expect(long.length).toBe(28);
    expect(long.endsWith('….jpeg')).toBe(true);
    expect(upperFirst('roles')).toBe('Roles');
  });
  it('turns industry groups into drop-down groups', () => {
    const packs = [{ id: 'healthcare', name: 'Healthcare', appliedAt: '2026-11-01' }];
    const g = pickGroups(industryGroups([{ name: 'Nurse', industries: ['healthcare'] }, { name: 'Own', industries: [] }], packs), r => ({ value: r.name, label: r.name }));
    expect(g.map(x => [x.label, x.items.map(i => i.value)])).toEqual([['Healthcare', ['Nurse']], ['Added by you', ['Own']]]);
  });
});

describe('MultiPick', () => {
  it('renders real tick boxes inside a closed drop-down, with chips for what is chosen', () => {
    const html = renderToStaticMarkup(<MultiPick name="roles" label="Roles you’re applying for" noun={noun} groups={groups} initial={['Carer']} />);
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('aria-expanded="false"');
    expect((html.match(/type="checkbox" name="roles"/g) ?? []).length).toBe(4);
    expect(html).toContain('checked="" value="Carer"');
    expect(html).toContain('1 role chosen');
    expect(html).toContain('aria-label="Remove Personal care worker"');
    expect(html).toContain('Labour hire');
  });
  it('shows a search box only for longer lists, and nothing extra when nothing is chosen', () => {
    const many = [{ key: 'own', label: 'Added by you', items: Array.from({ length: 8 }, (_, i) => ({ value: `r${i}`, label: `Role ${i}` })) }];
    const html = renderToStaticMarkup(<MultiPick name="roles" label="Roles" noun={noun} groups={many} showHeadings={false} />);
    expect(html).toContain('aria-label="Search roles"');
    expect(html).toContain('Choose roles');
    expect(html).not.toContain('multi-pick-chips');
    expect(html).not.toContain('Added by you');
  });
});

const view: ApplyView = {
  business: 'Example Care', slug: 'example', intro: null, open: true, country: 'AU',
  questions: ['name', 'email', 'roles', 'work_type', 'availability', 'credentials', 'consent'].map(key => ({ key: key as never, required: key !== 'roles' && key !== 'credentials' && key !== 'work_type' && key !== 'availability' })),
  custom: [],
  roles: [{ name: 'Nurse', industries: ['healthcare'] }, { name: 'Labourer', industries: ['labour'] }],
  credentials: [{ id: '11111111-1111-4111-8111-111111111111', name: 'First aid', industries: ['healthcare', 'labour'] }, { id: '22222222-2222-4222-8222-222222222222', name: 'Forklift licence', industries: ['labour'] }],
  packs: [{ id: 'healthcare', name: 'Healthcare', appliedAt: '2026-11-01' }, { id: 'labour', name: 'Labour hire', appliedAt: '2026-11-01' }],
  choices: { workTypes: [{ value: 'casual', label: 'Casual' }, { value: 'part_time', label: 'Part time' }], rightToWork: [], heard: [], home: { suburb: 'Suburb', region: 'State', postcode: 'Postcode' } },
  word: { role: 'role', roles: 'roles', credentials: 'credentials' },
  consentVersion: '0.3', maxFiles: 10, turnstileSiteKey: null, formToken: 't',
};

describe('the application form', () => {
  it('uses drop-downs for roles and qualifications, posting the same fields, with no file inputs until something is chosen', () => {
    const html = renderToStaticMarkup(<ApplyForm view={view} preview />);
    expect((html.match(/<details/g) ?? []).length).toBe(2);
    expect(html).toContain('name="roles" value="Nurse"');
    expect(html).toContain('name="credentials" value="22222222-2222-4222-8222-222222222222"');
    expect(html).toContain('Choose roles');
    expect(html).toContain('Choose qualifications and tickets');
    expect(html).not.toContain('type="file"');
    expect((html.match(/up to 10 MB/g) ?? []).length).toBe(1);
    expect(html).toContain('Across your industries');
    expect(html).toContain('<span aria-hidden="true">Mon</span><span class="sr-only">Monday</span>');
    expect(html).toContain('Preview: this is how applicants see the form');
  });
});
