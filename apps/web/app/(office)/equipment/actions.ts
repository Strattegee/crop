'use server';

import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { attempt, failTo, str } from '../../../lib/actions';

export async function addEquipment(f: FormData) {
  let id = '';
  try {
    id = (await api<{ id: string }>('/equipment', { method: 'POST', body: {
      equipmentTypeId: str(f, 'equipmentTypeId'), name: str(f, 'name'), assetNumber: str(f, 'assetNumber'),
      registration: str(f, 'registration'), homeFacilityId: str(f, 'homeFacilityId') ?? null,
    } })).id;
  } catch (err) {
    failTo('/equipment', err);
  }
  redirect(`/equipment/${id}?done=${encodeURIComponent('Added. Record its registration, service or inspection dates below.')}`);
}

export async function addType(f: FormData) {
  await attempt('/equipment', () => api('/equipment-types', { method: 'POST', body: { name: str(f, 'name'), operatorCredentialTypeId: str(f, 'operatorCredentialTypeId') ?? null, vehicle: f.get('vehicle') === 'on' } }), 'Equipment type added.');
}

export async function setStatus(id: string, f: FormData) {
  await attempt(`/equipment/${id}`, () => api(`/equipment/${id}`, { method: 'PATCH', body: { status: str(f, 'status') } }), 'Status changed.');
}

export async function addCheck(id: string, f: FormData) {
  await attempt(`/equipment/${id}`, () => api(`/equipment/${id}/checks`, { method: 'POST', body: { name: str(f, 'name'), dueOn: str(f, 'dueOn'), notes: str(f, 'notes') } }), 'Date saved. It replaces any earlier date with the same name.');
}

/** Marks an equipment type as a vehicle or not (V or E on roster cards, David 30 Oct). */
export async function setTypeVehicle(id: string, vehicle: boolean) {
  await attempt('/equipment', () => api(`/equipment-types/${id}`, { method: 'PATCH', body: { vehicle } }), vehicle ? 'Marked as a vehicle.' : 'No longer a vehicle.');
}
