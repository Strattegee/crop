'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

const BACK = '/settings/onboarding';

export type ChecklistStep = { id: string; title: string; help: string | null; kind: string; credentialTypeId: string | null; typeName: string | null; required: boolean };
export type Checklist = { id: string; name: string; description: string | null; archived: boolean; inProgress: number; steps: ChecklistStep[] };

const asInput = (s: ChecklistStep) => ({ id: s.id, kind: s.kind, title: s.title, help: s.help, credentialTypeId: s.credentialTypeId, required: s.required });

/** Reads the checklist, changes its step list and saves the whole list (steps keep their ids). */
async function editSteps(id: string, change: (steps: ReturnType<typeof asInput>[]) => unknown[], done: string) {
  await attempt(BACK, async () => {
    const all = await api<Checklist[]>('/onboarding-checklists?archived=true');
    const c = all.find(x => x.id === id);
    if (!c) throw new Error('Checklist not found');
    await api(`/onboarding-checklists/${id}`, { method: 'PATCH', body: { steps: change(c.steps.map(asInput)) } });
  }, done);
}

/** The step picker's value: task, right_to_work, employment or cred:<credentialTypeId>. */
function stepFrom(f: FormData) {
  const what = str(f, 'what') ?? 'task';
  const base = { title: str(f, 'title') ?? null, help: str(f, 'help') ?? null, required: f.get('required') === 'on' };
  if (what.startsWith('cred:')) return { ...base, kind: 'credential', credentialTypeId: what.slice(5) };
  return { ...base, kind: what, credentialTypeId: null };
}

export async function addChecklist(f: FormData) {
  const fromRequirements = f.get('fromRequirements') === 'on';
  const roles = (str(f, 'roles') ?? '').split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
  await attempt(BACK, () => api('/onboarding-checklists', {
    method: 'POST', body: { name: str(f, 'name'), description: str(f, 'description') ?? null, fromRequirements, roles },
  }), fromRequirements ? 'Checklist added from your credential rules. Add your own tasks below.' : 'Checklist added. Now add its steps.');
}

export async function renameChecklist(id: string, f: FormData) {
  await attempt(BACK, () => api(`/onboarding-checklists/${id}`, { method: 'PATCH', body: { name: str(f, 'name'), description: str(f, 'description') ?? null } }), 'Checklist saved.');
}

export async function setArchived(id: string, archived: boolean) {
  await attempt(BACK, () => api(`/onboarding-checklists/${id}`, { method: 'PATCH', body: { archived } }),
    archived ? 'Checklist put away. People already using it can finish.' : 'Checklist back in use.');
}

export async function addStep(id: string, f: FormData) {
  const step = stepFrom(f);
  await editSteps(id, steps => [...steps, step], 'Step added.');
}

export async function moveStep(id: string, stepId: string, by: -1 | 1) {
  await editSteps(id, steps => {
    const i = steps.findIndex(s => s.id === stepId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= steps.length) return steps;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }, 'Step moved.');
}

export async function toggleRequired(id: string, stepId: string) {
  await editSteps(id, steps => steps.map(s => (s.id === stepId ? { ...s, required: !s.required } : s)), 'Step changed.');
}

export async function removeStep(id: string, stepId: string) {
  await editSteps(id, steps => steps.filter(s => s.id !== stepId), 'Step taken out.');
}
