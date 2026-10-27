'use server';

import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { attempt, failTo as fail, str } from '../../../lib/actions';

export async function addClient(f: FormData) {
  let id: string | undefined;
  try {
    id = (await api<{ id: string }>('/clients', {
      method: 'POST',
      body: { name: str(f, 'name'), abn: str(f, 'abn'), billingContactName: str(f, 'billingContactName'), billingEmail: str(f, 'billingEmail'), phone: str(f, 'phone') },
    })).id;
  } catch (err) {
    fail('/clients', err);
  }
  redirect(`/clients/${id}?done=${encodeURIComponent('Client added. Now add their facilities.')}`);
}

export async function updateClient(id: string, f: FormData) {
  await attempt(`/clients/${id}`, () => api(`/clients/${id}`, {
    method: 'PATCH',
    body: {
      name: str(f, 'name'), status: str(f, 'status'), abn: str(f, 'abn') ?? null, phone: str(f, 'phone') ?? null,
      billingContactName: str(f, 'billingContactName') ?? null, billingEmail: str(f, 'billingEmail') ?? null, notes: str(f, 'notes') ?? null,
    },
  }), 'Client saved.');
}

export async function addFacility(clientId: string | null, f: FormData) {
  const back = clientId ? `/clients/${clientId}` : '/facilities';
  let id: string | undefined;
  try {
    id = (await api<{ id: string }>('/facilities', {
      method: 'POST',
      body: {
        clientId: clientId ?? str(f, 'clientId'), name: str(f, 'name'), addressLine: str(f, 'addressLine'),
        suburb: str(f, 'suburb'), state: str(f, 'state'), postcode: str(f, 'postcode'), phone: str(f, 'phone'),
        country: str(f, 'country'), ...(str(f, 'timezone') ? { timezone: str(f, 'timezone') } : {}),
      },
    })).id;
  } catch (err) {
    fail(back, err);
  }
  redirect(`/facilities/${id}?done=${encodeURIComponent('Facility added. Add its wards or units below.')}`);
}

export async function updateFacility(id: string, f: FormData) {
  await attempt(`/facilities/${id}`, () => api(`/facilities/${id}`, {
    method: 'PATCH',
    body: {
      name: str(f, 'name'), addressLine: str(f, 'addressLine') ?? null, suburb: str(f, 'suburb') ?? null,
      state: str(f, 'state') ?? null, postcode: str(f, 'postcode') ?? null, phone: str(f, 'phone') ?? null,
      country: str(f, 'country'), ...(str(f, 'timezone') ? { timezone: str(f, 'timezone') } : {}),
      parkingNotes: str(f, 'parkingNotes') ?? null, entryNotes: str(f, 'entryNotes') ?? null,
    },
  }), 'Facility saved.');
}

export async function addArea(facilityId: string, f: FormData) {
  await attempt(`/facilities/${facilityId}`, () => api(`/facilities/${facilityId}/areas`, {
    method: 'POST', body: { name: str(f, 'name'), specialty: str(f, 'specialty') },
  }), 'Area added.');
}

export async function setAreaActive(facilityId: string, areaId: string, active: boolean) {
  await attempt(`/facilities/${facilityId}`, () => api(`/facilities/${facilityId}/areas/${areaId}`, { method: 'PATCH', body: { active } }));
}
