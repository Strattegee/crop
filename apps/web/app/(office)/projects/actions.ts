'use server';

import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { attempt, failTo as fail, str } from '../../../lib/actions';
import { parseAreaList } from '../../../lib/projects';
import { T, words } from '../../../lib/terms';

const page = (id: string, tab?: string) => `/projects/${id}${tab ? `?tab=${tab}` : ''}`;
const opt = (f: FormData, k: string) => (f.has(k) ? { [k]: str(f, k) ?? null } : {});

/** New project (a site of kind project) with its work areas, then its page. Owners and admins. */
export async function addProject(f: FormData) {
  let id: string | undefined;
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
    fail(id ? page(id, 'areas') : '/projects?new=1', err);
  }
  const tw = await words();
  redirect(`/projects/${id}?done=${encodeURIComponent(areas.length ? `${tw.one(T.project)} added with its ${tw.lower(T.area, true)}.` : `${tw.one(T.project)} added. Add its ${tw.lower(T.area, true)} next.`)}`);
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
