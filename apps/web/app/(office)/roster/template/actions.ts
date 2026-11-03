'use server';

import { redirect } from 'next/navigation';
import { api } from '../../../../lib/api';
import { attempt, failTo, str } from '../../../../lib/actions';
import { addedMessage, templateHref, templateShiftBody } from '../../../../lib/roster-template';
import { T, words } from '../../../../lib/terms';

/** The Template tab (David, 3 Nov): every form carries `site` and `template`, the page to come back to. */
const page = (f: FormData, extra: Record<string, string | null | undefined> = {}) => templateHref(str(f, 'site') ?? null, str(f, 'template') ?? null, extra);
type Detail = { id: string; name: string; shifts: number };

/** Starts a template: empty, or from a week of the site's roster (with or without the people and equipment). */
export async function startTemplate(f: FormData) {
  const fromWeek = str(f, 'weekStart');
  let made: Detail | null = null;
  try {
    made = await api<Detail>('/roster/templates', {
      method: 'POST',
      body: fromWeek
        ? { facilityId: str(f, 'site'), name: str(f, 'name'), weekStart: fromWeek, people: f.get('people') === 'on', equipment: f.get('equipment') === 'on' }
        : { facilityId: str(f, 'site'), name: str(f, 'name'), empty: true },
    });
  } catch (e) { failTo(page(f), e); }
  const tw = await words();
  const done = fromWeek ? `Saved the week as "${made!.name}" with ${tw.count(made!.shifts, T.shift)}.` : `Started "${made!.name}". Add its ${tw.lower(T.shift, true)} day by day.`;
  redirect(`${templateHref(str(f, 'site') ?? null, made!.id)}&done=${encodeURIComponent(done)}`);
}

export async function renameTemplate(f: FormData) {
  await attempt(page(f), () => api(`/roster/templates/${str(f, 'template')}`, { method: 'PATCH', body: { name: str(f, 'name') } }), 'Template renamed.');
}

export async function putAwayTemplate(f: FormData) {
  try {
    await api(`/roster/templates/${str(f, 'template')}/archive`, { method: 'POST' });
  } catch (e) { failTo(page(f), e); }
  redirect(`${templateHref(str(f, 'site') ?? null, null)}&done=${encodeURIComponent('Template put away. Weeks already filled from it don\'t change.')}`);
}

export async function addTemplateShifts(f: FormData) {
  const body = templateShiftBody(f, true);
  const tw = await words();
  await attempt(page(f), () => api(`/roster/templates/${str(f, 'template')}/shifts`, { method: 'POST', body }),
    addedMessage(body.weekdays as number[], n => tw.count(n, T.shift)));
}

export async function changeTemplateShift(shiftId: string, f: FormData) {
  let newId = '';
  try {
    newId = (await api<{ shiftId: string }>(`/roster/template-shifts/${shiftId}`, { method: 'PUT', body: templateShiftBody(f, false) })).shiftId;
  } catch (e) { failTo(page(f, { slot: shiftId }), e); }
  redirect(`${page(f, { slot: newId })}&done=${encodeURIComponent('Saved. Weeks already filled from the template don\'t change.')}`);
}

export async function removeTemplateShift(shiftId: string, f: FormData) {
  const tw = await words();
  await attempt(page(f), () => api(`/roster/template-shifts/${shiftId}/remove`, { method: 'POST' }), `${tw.one(T.shift)} taken out of the template.`);
}

/** Fills a week from the template, then opens that week on the roster with the summary. */
export async function fillWeekFromTemplate(f: FormData) {
  let week = str(f, 'week');
  let summary = '';
  try {
    ({ summary, weekStart: week } = await api<{ summary: string; weekStart: string }>(`/roster/templates/${str(f, 'template')}/apply`, {
      method: 'POST', body: { weekStart: week, people: f.get('people') === 'on', equipment: f.get('equipment') === 'on', addToExisting: f.get('addToExisting') === 'on' },
    }));
  } catch (e) { failTo(page(f), e); }
  const site = str(f, 'site');
  redirect(`/roster?week=${encodeURIComponent(week ?? '')}${site ? `&site=${site}` : ''}&done=${encodeURIComponent(summary)}`);
}
