import type { PoolClient } from 'pg';
import { acrossSites } from '@crop/db';
import { fillReasons, wordsFor } from '../terms/words.js';
import { credentialFactsByWorker } from '../workforce/compliance-data.js';
import { agencyCredentialsForShifts } from './agency-credentials.js';
import { loadSettings } from '../workforce/settings.js';
import { loadShiftFacts } from './eligibility-data.js';
import type { Eligibility, OtherShift } from './eligibility.js';
import { allocatedElsewhere, type AllocationFact } from '../projects/projects.js';
import { equipmentEligibility, type EquipmentCheckFacts, type EquipmentStatus } from './equipment.js';

export interface EquipmentCandidate {
  equipmentId: string;
  name: string;
  typeName: string;
  status: EquipmentStatus;
  eligible: boolean;
  blocks: Eligibility['blocks'];
  warnings: Eligibility['warnings'];
}

/** Current dates per piece of equipment (within withTenant). */
export async function currentChecks(db: PoolClient, equipmentIds: string[]): Promise<Map<string, Array<EquipmentCheckFacts & { id: string; notes: string | null }>>> {
  const map = new Map<string, Array<EquipmentCheckFacts & { id: string; notes: string | null }>>();
  for (const r of (await db.query<{ id: string; equipment_id: string; name: string; due_on: string; notes: string | null }>(
    `select id, equipment_id, name, to_char(due_on, 'YYYY-MM-DD') as due_on, notes from equipment_checks
      where superseded_at is null and equipment_id = any($1) order by due_on, name`, [equipmentIds])).rows) {
    const list = map.get(r.equipment_id) ?? [];
    list.push({ id: r.id, name: r.name, dueOn: r.due_on, notes: r.notes });
    map.set(r.equipment_id, list);
  }
  return map;
}

/**
 * Works out which equipment may be booked to a shift (within withTenant). Pass equipmentIds to check
 * particular items (any status), or leave it out for everything active.
 */
export async function equipmentForShift(db: PoolClient, tenantId: string, shiftId: string, equipmentIds?: string[]): Promise<EquipmentCandidate[]> {
  const shift = await loadShiftFacts(db, shiftId);
  const { needs_person: needsPerson, facility_id: facilityId } = (await db.query<{ needs_person: boolean; facility_id: string }>(
    'select needs_person, facility_id from shifts where id = $1', [shiftId])).rows[0];
  const items = (await db.query<{ id: string; name: string; type_name: string; status: EquipmentStatus; op_id: string | null; op_name: string | null }>(
    `select e.id, e.name, et.name as type_name, e.status, ct.id as op_id, ct.name as op_name
       from equipment e join equipment_types et on et.id = e.equipment_type_id
       left join credential_types ct on ct.id = et.operator_credential_type_id
      where ${equipmentIds ? 'e.id = any($1)' : "e.status = 'active' and et.active and $1::uuid[] is null"}
      order by et.name, e.name`, [equipmentIds ?? null])).rows;
  if (!items.length) return [];
  const ids = items.map(i => i.id);
  const settings = await loadSettings(db, tenantId);
  const checks = await currentChecks(db, ids);

  const others = new Map<string, OtherShift[]>();
  // Every site (migration 0086): bookings and allocations elsewhere still block, whoever is asking.
  for (const o of (await acrossSites(db, () => db.query<{ equipment_id: string; id: string; role: string; starts_at: Date; ends_at: Date; local_date: string; hours: number; facility: string; label: string }>(
    `select sa.equipment_id, s.id, s.role, s.starts_at, s.ends_at, f.name as facility,
            to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as local_date,
            (extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0)::float8 as hours,
            to_char(s.starts_at at time zone f.timezone, 'Dy DD Mon HH24:MI') || '–' || to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as label
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
      where sa.equipment_id = any($1) and sa.resource_kind = 'equipment' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
        and s.starts_at < $3 and s.ends_at > $2`,
    [ids, shift.startsAt, shift.endsAt]))).rows) {
    const list = others.get(o.equipment_id) ?? [];
    list.push({ id: o.id, role: o.role, startsAt: o.starts_at, endsAt: o.ends_at, localDate: o.local_date, hours: o.hours, facilityName: o.facility, label: o.label });
    others.set(o.equipment_id, list);
  }

  const allocations = await allocationsOn(db, ids, shift.localDate);

  const p = (await db.query<{ worker_id: string; name: string }>(
    `select sa.worker_id, coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as name
       from shift_assignments sa join workers w on w.id = sa.worker_id
      where sa.shift_id = $1 and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')`, [shiftId])).rows[0];
  // An agency's person holds what their agency confirmed for this shift (they have no records here).
  const agencyCreds = p ? (await agencyCredentialsForShifts(db, [shiftId])).get(`${shiftId}:${p.worker_id}`) : undefined;
  const person = p ? { name: p.name, credentials: agencyCreds ?? (await credentialFactsByWorker(db, [p.worker_id])).get(p.worker_id) ?? [] } : null;

  const words = await wordsFor(db);
  return items.map(i => ({
    equipmentId: i.id, name: i.name, typeName: i.type_name, status: i.status,
    ...fillReasons(equipmentEligibility(shift, {
      name: i.name, status: i.status, checks: checks.get(i.id) ?? [], others: others.get(i.id) ?? [],
      operator: i.op_id ? { credentialTypeId: i.op_id, typeName: i.op_name! } : null, person, windowDays: settings.expiringWindowDays,
      equipmentOnly: !needsPerson,
      allocatedElsewhere: allocatedElsewhere(i.name, facilityId, shift.localDate, allocations.get(i.id) ?? []),
    }), words),
  }));
}

/** Live allocations of each piece of equipment covering a date (migration 0084), within withTenant. */
export async function allocationsOn(db: PoolClient, equipmentIds: string[], onDate: string): Promise<Map<string, AllocationFact[]>> {
  const out = new Map<string, AllocationFact[]>();
  for (const r of (await acrossSites(db, () => db.query<AllocationFact & { equipmentId: string }>(
    `select a.id, a.equipment_id as "equipmentId", a.facility_id as "facilityId", f.name as "siteName",
            to_char(a.starts_on, 'YYYY-MM-DD') as "from", to_char(a.ends_on, 'YYYY-MM-DD') as "to"
       from equipment_site_allocations a join facilities f on f.id = a.facility_id
      where a.equipment_id = any($1) and a.removed_at is null and a.starts_on <= $2 and (a.ends_on is null or a.ends_on >= $2)`,
    [equipmentIds, onDate]))).rows) {
    const { equipmentId, ...a } = r;
    out.set(equipmentId, [...(out.get(equipmentId) ?? []), a]);
  }
  return out;
}

/** Ready first, then with warnings, then blocked; by type and name. */
export function rankEquipment(list: EquipmentCandidate[]): EquipmentCandidate[] {
  const group = (c: EquipmentCandidate) => (!c.eligible ? 2 : c.warnings.length ? 1 : 0);
  return [...list].sort((a, b) => group(a) - group(b) || a.typeName.localeCompare(b.typeName) || a.name.localeCompare(b.name));
}
