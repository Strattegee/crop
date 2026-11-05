'use server';

import { redirect } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';
import { attempt, failTo as fail, str } from '../../../lib/actions';
import { makeUpFromForm, splitPick } from '../../../lib/teams';
import { T, words } from '../../../lib/terms';

const back = (id?: string) => (id ? `/teams?team=${id}` : '/teams');
const lines = (f: FormData) => Math.min(80, Number(str(f, 'lines') ?? '0') || 0);
const makeUp = (f: FormData) => makeUpFromForm(k => str(f, k), lines(f));

/** A new team with its make-up, then its card open for adding people. */
export async function addTeam(f: FormData) {
  const roles = makeUp(f);
  if ('problem' in roles) fail('/teams?new=1', new ApiError(400, roles.problem));
  let id: string | undefined;
  try {
    id = (await api<{ id: string }>('/teams', { method: 'POST', body: { name: str(f, 'name'), description: str(f, 'description'), roles } })).id;
  } catch (err) {
    fail('/teams?new=1', err);
  }
  const tw = await words();
  redirect(`/teams?team=${id}&done=${encodeURIComponent(`${tw.one(T.team)} added. Name its people next.`)}`);
}

export async function updateTeam(id: string, f: FormData) {
  await attempt(back(id), () => api(`/teams/${id}`, { method: 'PATCH', body: { name: str(f, 'name'), description: str(f, 'description') ?? null } }), 'Saved.');
}

export async function setTeamRoles(id: string, f: FormData) {
  const roles = makeUp(f);
  await attempt(back(id), async () => {
    if ('problem' in roles) throw new ApiError(400, roles.problem);
    await api(`/teams/${id}/roles`, { method: 'PUT', body: { roles } });
  }, 'Make-up saved.');
}

export async function addTeamPerson(id: string, f: FormData) {
  const pick = splitPick(str(f, 'pick'));
  const tw = await words();
  await attempt(back(id), async () => {
    if (!pick) throw new ApiError(400, `Choose a person and the ${tw.lower(T.role)} they fill`);
    await api(`/teams/${id}/members`, { method: 'POST', body: { ...pick, startsOn: str(f, 'startsOn') } });
  }, `Added to the ${tw.lower(T.team)}.`);
}

export async function removeTeamPerson(id: string, memberId: string, f: FormData) {
  const tw = await words();
  await attempt(back(id), () => api(`/team-members/${memberId}/remove`, { method: 'POST', body: { reason: str(f, 'reason'), lastDay: str(f, 'lastDay') } }),
    `Taken off the ${tw.lower(T.team)} (kept on file).`);
}

export async function setTeamActive(id: string, active: boolean) {
  const tw = await words();
  await attempt(active ? back(id) : '/teams', () => api(`/teams/${id}`, { method: 'PATCH', body: { active } }),
    active ? `${tw.one(T.team)} brought back.` : `${tw.one(T.team)} put away. Find it under Put away.`);
}
