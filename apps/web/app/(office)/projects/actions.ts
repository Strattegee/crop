'use server';

import { redirect } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';
import { attempt, failTo as fail, str } from '../../../lib/actions';
import { newProjectDone, newProjectFrom, newProjectRetry, parseAreaList } from '../../../lib/projects';
import { moveMessage, rosterMessage, weekdaysFromForm, type MoveResult, type RosterResult } from '../../../lib/project-stages';
import { makeUpFromForm, splitPick } from '../../../lib/teams';
import { T, words } from '../../../lib/terms';

const page = (id: string, tab?: string) => `/projects/${id}${tab ? `?tab=${tab}` : ''}`;
const opt = (f: FormData, k: string) => (f.has(k) ? { [k]: str(f, k) ?? null } : {});

/**
 * New project (a site of kind project) with its work areas. Owners and admins. From the roster it goes back to the
 * roster with the new project on its own; from the Projects list or a client's page, to the project's page.
 */
export async function addProject(f: FormData) {
  let id: string | undefined;
  const from = newProjectFrom(str(f, 'from'), str(f, 'week'), str(f, 'clientId'));
  const areas = parseAreaList(str(f, 'areas'));
  try {
    id = (await api<{ id: string }>('/facilities', {
      method: 'POST',
      body: {
        kind: 'project', name: str(f, 'name'), code: str(f, 'code'), description: str(f, 'description'), clientId: str(f, 'clientId'),
        addressLine: str(f, 'addressLine'), suburb: str(f, 'suburb'), state: str(f, 'state'), postcode: str(f, 'postcode'),
        country: str(f, 'country'), ...(str(f, 'timezone') ? { timezone: str(f, 'timezone') } : {}),
        startsOn: str(f, 'startsOn'), endsOn: str(f, 'endsOn'), managerUserId: str(f, 'managerUserId'), status: str(f, 'status'),
        ...opt(f, 'officeId'),
      },
    })).id;
    for (const name of areas) await api(`/facilities/${id}/areas`, { method: 'POST', body: { name } });
  } catch (err) {
    fail(id ? page(id, 'areas') : newProjectRetry(from), err);
  }
  const tw = await words();
  const next = newProjectDone(from, id!);
  if (from.from === 'roster') {
    redirect(`${next}&done=${encodeURIComponent(`${tw.one(T.project)} added. It is shown on its own here; add its ${tw.lower(T.shift, true)} to this Draft week.`)}`);
  }
  redirect(`${next}?done=${encodeURIComponent(areas.length ? `${tw.one(T.project)} added with its ${tw.lower(T.area, true)}.` : `${tw.one(T.project)} added. Add its ${tw.lower(T.area, true)} next.`)}`);
}

export async function updateProject(id: string, f: FormData) {
  await attempt(page(id, 'overview'), () => api(`/facilities/${id}`, {
    method: 'PATCH',
    body: {
      name: str(f, 'name'), code: str(f, 'code') ?? null, description: str(f, 'description') ?? null, clientId: str(f, 'clientId') ?? null,
      status: str(f, 'status'), startsOn: str(f, 'startsOn') ?? null, endsOn: str(f, 'endsOn') ?? null, managerUserId: str(f, 'managerUserId') ?? null,
      addressLine: str(f, 'addressLine') ?? null, suburb: str(f, 'suburb') ?? null, state: str(f, 'state') ?? null, postcode: str(f, 'postcode') ?? null,
      country: str(f, 'country'), ...(str(f, 'timezone') ? { timezone: str(f, 'timezone') } : {}), ...opt(f, 'officeId'),
    },
  }), 'Saved.');
}

export async function addWorkArea(id: string, f: FormData) {
  const names = parseAreaList(str(f, 'name'));
  const tw = await words();
  await attempt(page(id, 'areas'), async () => {
    for (const name of names) await api(`/facilities/${id}/areas`, { method: 'POST', body: { name, specialty: str(f, 'specialty') } });
  }, names.length === 1 ? `${tw.one(T.area)} added.` : `${names.length} ${tw.lower(T.area, true)} added.`);
}

export async function setWorkAreaActive(id: string, areaId: string, active: boolean) {
  await attempt(page(id, 'areas'), () => api(`/facilities/${id}/areas/${areaId}`, { method: 'PATCH', body: { active } }));
}

export async function addTeamMember(id: string, f: FormData) {
  await attempt(page(id, 'team'), () => api(`/facilities/${id}/team`, {
    method: 'POST',
    body: { workerId: str(f, 'workerId'), teamRole: str(f, 'teamRole'), areaId: str(f, 'areaId'), startsOn: str(f, 'startsOn'), endsOn: str(f, 'endsOn') },
  }), 'Added to the team.');
}

export async function updateTeamMember(id: string, memberId: string, f: FormData) {
  await attempt(page(id, 'team'), () => api(`/site-members/${memberId}`, {
    method: 'PATCH', body: { teamRole: str(f, 'teamRole'), areaId: str(f, 'areaId') ?? null, endsOn: str(f, 'endsOn') ?? null },
  }), 'Team saved.');
}

export async function removeTeamMember(id: string, memberId: string) {
  await attempt(page(id, 'team'), () => api(`/site-members/${memberId}/remove`, { method: 'POST', body: { reason: 'Added by mistake' } }),
    'Taken off the team list (kept on file).');
}

export async function allocateEquipment(id: string, f: FormData) {
  const tw = await words();
  await attempt(page(id, 'equipment'), () => api(`/equipment/${str(f, 'equipmentId') ?? 'none'}/allocations`, {
    method: 'POST',
    body: { facilityId: id, areaId: str(f, 'areaId'), startsOn: str(f, 'startsOn'), endsOn: str(f, 'endsOn'), note: str(f, 'note') },
  }), `Allocated. Booking it onto ${tw.lower(T.shift) === 'shift' ? 'a shift' : `a ${tw.lower(T.shift)}`} anywhere else is now refused for those dates.`);
}

export async function endAllocation(id: string, allocationId: string, f: FormData) {
  await attempt(page(id, 'equipment'), () => api(`/equipment-allocations/${allocationId}/end`, {
    method: 'POST', body: { lastDay: str(f, 'lastDay') ?? null },
  }), 'Dates saved.');
}

export async function moveAllocation(id: string, allocationId: string, f: FormData) {
  await attempt(page(id, 'equipment'), () => api(`/equipment-allocations/${allocationId}/move`, {
    method: 'POST', body: { facilityId: str(f, 'facilityId'), onDate: str(f, 'onDate') },
  }), 'Moved. It ends here the day before and starts at the new place that day.');
}

export async function removeAllocation(id: string, allocationId: string) {
  await attempt(page(id, 'equipment'), () => api(`/equipment-allocations/${allocationId}/remove`, { method: 'POST', body: { reason: 'Added by mistake' } }),
    'Allocation taken off (kept on file).');
}

// Project stages (David, 5 Nov; migration 0093). Everything returns to the Stages tab.
const stagesTab = (id: string) => page(id, 'stages');
const makeUp = (f: FormData) => makeUpFromForm(k => str(f, k), Math.min(80, Number(str(f, 'lines') ?? '0') || 0));

function stageBody(f: FormData) {
  const code = str(f, 'shiftCodeId');
  return {
    name: str(f, 'name'), areaId: str(f, 'areaId') ?? null, startsOn: str(f, 'startsOn'), endsOn: str(f, 'endsOn'),
    weekdays: weekdaysFromForm(k => str(f, k)), notes: str(f, 'notes') ?? null, shiftCodeId: code ?? null,
    // A shift type gives the hours unless times are typed too.
    ...(code && !str(f, 'startTime') ? {} : { startTime: str(f, 'startTime') ?? null, endTime: str(f, 'endTime') ?? null, breakMinutes: Number(str(f, 'breakMinutes') ?? '0') || 0 }),
  };
}

/** The team chosen on a stage form: a standing team, or a new one made from the form (name and make-up). */
async function chosenTeam(f: FormData): Promise<string | null> {
  const pick = str(f, 'teamId');
  if (pick !== '__new') return pick ?? null;
  const roles = makeUp(f);
  if ('problem' in roles) throw new ApiError(400, roles.problem);
  return (await api<{ id: string }>('/teams', { method: 'POST', body: { name: str(f, 'newTeamName'), roles } })).id;
}

export async function addStage(id: string, f: FormData) {
  await attempt(stagesTab(id), async () => {
    const teamId = await chosenTeam(f);
    await api(`/projects/${id}/stages`, { method: 'POST', body: { ...stageBody(f), ...(teamId ? { teamId } : {}) } });
  }, 'Stage added.');
}

type WithShifts = { shifts: MoveResult | null; shiftsSummary: string | null };

export async function updateStage(id: string, stageId: string, f: FormData) {
  let r: ({ moved: unknown[] } & WithShifts) | undefined;
  await attempt(stagesTab(id), async () => {
    r = await api<{ moved: unknown[] } & WithShifts>(`/project-stages/${stageId}`, {
      method: 'PATCH', body: { ...stageBody(f), moveLater: f.get('moveLater') === 'on', moveShifts: f.get('moveShifts') === 'on' },
    });
  }, () => {
    const moved = r!.moved.length;
    const said = moved ? `Stage saved. ${moved === 1 ? '1 later stage' : `${moved} later stages`} moved too.` : 'Stage saved.';
    const shifts = moveMessage(r!.shifts, r!.shiftsSummary);
    return shifts ? `${said} ${shifts}` : said;
  });
}

export async function removeStage(id: string, stageId: string, f: FormData) {
  const tw = await words();
  const cancelShifts = f.get('cancelShifts') === 'on';
  let r: WithShifts | undefined;
  await attempt(stagesTab(id), async () => { r = await api<WithShifts>(`/project-stages/${stageId}/remove`, { method: 'POST', body: { cancelShifts } }); },
    () => `Stage taken off. ${moveMessage(r!.shifts, r!.shiftsSummary) ?? `${tw.many(T.shift)} already made for it stay on the roster.`}`);
}

export async function moveStageShifts(id: string, stageId: string) {
  let r: (MoveResult & { summary: string }) | undefined;
  await attempt(stagesTab(id), async () => { r = await api<MoveResult & { summary: string }>(`/project-stages/${stageId}/move-shifts`, { method: 'POST', body: {} }); },
    () => moveMessage(r!, r!.summary)!);
}

export async function setStageTeam(id: string, stageId: string, f: FormData) {
  const tw = await words();
  await attempt(stagesTab(id), async () => {
    const teamId = await chosenTeam(f);
    await api(`/project-stages/${stageId}/team`, { method: 'PUT', body: { teamId } });
  }, `${tw.one(T.team)} copied to this stage. Changes here never change the ${tw.lower(T.team)} itself.`);
}

export async function setStageRoles(id: string, stageId: string, f: FormData) {
  const roles = makeUp(f);
  await attempt(stagesTab(id), async () => {
    if ('problem' in roles) throw new ApiError(400, roles.problem);
    await api(`/project-stages/${stageId}/roles`, { method: 'PUT', body: { roles } });
  }, 'Make-up saved for this stage.');
}

export async function addStagePerson(id: string, stageId: string, f: FormData) {
  const pick = splitPick(str(f, 'pick'));
  await attempt(stagesTab(id), async () => {
    if (!pick) throw new ApiError(400, 'Choose a person');
    await api(`/project-stages/${stageId}/people`, { method: 'POST', body: pick });
  }, 'Named for this stage.');
}

export async function removeStagePerson(id: string, personId: string) {
  await attempt(stagesTab(id), () => api(`/project-stage-people/${personId}/remove`, { method: 'POST', body: {} }), 'Taken off this stage.');
}

export async function rosterStage(id: string, stageId: string) {
  let r: RosterResult | undefined;
  await attempt(stagesTab(id), async () => { r = await api<RosterResult>(`/project-stages/${stageId}/roster`, { method: 'POST', body: {} }); }, () => rosterMessage(r!));
}

export async function rosterProject(id: string) {
  let r: RosterResult | undefined;
  await attempt(stagesTab(id), async () => { r = await api<RosterResult>(`/projects/${id}/roster`, { method: 'POST', body: {} }); }, () => rosterMessage(r!));
}

export async function setProjectSupervisor(id: string, f: FormData, tab = 'stages') {
  await attempt(page(id, tab === 'overview' ? undefined : tab), () => api(`/projects/${id}/supervisor`, { method: 'PUT', body: { workerId: str(f, 'workerId') ?? null } }), 'Supervisor saved.');
}

export async function setProjectSupervisorFromOverview(id: string, f: FormData) {
  await setProjectSupervisor(id, f, 'overview');
}

export async function bookStageEquipment(id: string, stageId: string, f: FormData) {
  await attempt(stagesTab(id), () => api(`/project-stages/${stageId}/equipment`, { method: 'POST', body: { equipmentId: str(f, 'equipmentId') } }), 'Booked for the stage’s dates.');
}

export async function planStageItem(id: string, stageId: string, f: FormData) {
  await attempt(stagesTab(id), () => api(`/project-stages/${stageId}/items`, {
    method: 'POST', body: { itemId: str(f, 'itemId'), quantity: str(f, 'quantity'), note: str(f, 'note') || null },
  }), 'Planned for the stage.');
}

export async function removeStageItem(id: string, planId: string) {
  await attempt(stagesTab(id), () => api(`/project-stage-items/${planId}/remove`, { method: 'POST', body: {} }), 'Taken off the plan.');
}

export async function removeStageEquipment(id: string, allocationId: string) {
  await attempt(stagesTab(id), () => api(`/equipment-allocations/${allocationId}/remove`, { method: 'POST', body: {} }), 'Taken off.');
}

/** Copies another project's stages here (stage templates, 5 Nov): dates from the first day chosen, people and items when ticked. */
export async function copyStages(id: string, f: FormData) {
  let r: { summary: string } | undefined;
  await attempt(stagesTab(id), async () => {
    const fromProjectId = str(f, 'fromProjectId');
    if (!fromProjectId) throw new ApiError(400, 'Choose a project to copy from');
    r = await api<{ summary: string }>(`/projects/${id}/stages/copy`, {
      method: 'POST', body: { fromProjectId, startsOn: str(f, 'startsOn'), people: f.get('people') === 'on', items: f.get('items') === 'on' },
    });
  }, () => r!.summary);
}
