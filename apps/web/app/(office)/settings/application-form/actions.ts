'use server';

import { api } from '../../../../lib/api';
import { attempt } from '../../../../lib/actions';
import { choicesFromText, type CustomQuestion } from '../../../../lib/apply';

const BACK = '/settings/application-form';
type Settings = { builtIn: { key: string; allowed: string[] }[]; custom: CustomQuestion[] };

/** Open or closed, the welcome line and the starter questions' modes. */
export async function saveApplyBasics(f: FormData) {
  await attempt(BACK, async () => {
    const cur = await api<Settings>('/apply-form');
    const builtIn: Record<string, string> = {};
    for (const q of cur.builtIn) {
      const v = f.get(`mode_${q.key}`);
      if (typeof v === 'string' && q.allowed.length > 1) builtIn[q.key] = v;
    }
    await api('/apply-form', { method: 'PUT', body: { open: f.get('open') === 'on', intro: String(f.get('intro') ?? ''), builtIn } });
  }, 'Saved.');
}

function questionFrom(f: FormData, id?: string): Partial<CustomQuestion> {
  return {
    ...(id ? { id } : {}),
    label: String(f.get('label') ?? ''),
    help: String(f.get('help') ?? '') || null,
    type: String(f.get('type') ?? '') as CustomQuestion['type'],
    required: f.get('required') === 'on',
    choices: choicesFromText(String(f.get('choices') ?? '')),
  };
}

async function saveCustom(change: (list: Partial<CustomQuestion>[]) => Partial<CustomQuestion>[]) {
  const cur = await api<Settings>('/apply-form');
  await api('/apply-form', { method: 'PUT', body: { custom: change(cur.custom) } });
}

export async function addApplyQuestion(f: FormData) {
  await attempt(BACK, () => saveCustom(list => [...list, questionFrom(f)]), 'Question added.');
}

export async function saveApplyQuestion(f: FormData) {
  const id = String(f.get('id') ?? '');
  await attempt(BACK, () => saveCustom(list => list.map(q => (q.id === id ? questionFrom(f, id) : q))), 'Question saved.');
}

export async function removeApplyQuestion(f: FormData) {
  const id = String(f.get('id') ?? '');
  await attempt(BACK, () => saveCustom(list => list.filter(q => q.id !== id)), 'Question taken off the form. Answers already sent keep it.');
}

export async function moveApplyQuestion(f: FormData) {
  const id = String(f.get('id') ?? '');
  const up = f.get('dir') === 'up';
  await attempt(BACK, () => saveCustom(list => {
    const i = list.findIndex(q => q.id === id);
    const j = up ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }));
}
