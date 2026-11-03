/**
 * Editing a template as a week (David, 3 Nov, answer 2: the Template tab; migration 0079). Template shifts keep
 * their content append-only: a change inserts a new row that `replaces_id` the old one and marks the old one
 * `removed_at`; removing one only marks it. `parseTemplateShift` checks a body without the database;
 * `checkTemplateShift` checks it against the business's data; `insertTemplateShifts` writes the rows.
 */
import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { bool, gender, int, text } from '../common/validate.js';
import { UUID, time, uuidField } from './shift-create.js';

export interface TemplateShiftInput {
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number | null;
  role: string;
  areaId: string | null;
  shiftCodeId: string | null;
  needsPerson: boolean;
  /** The usual person (the T line once a week is filled from it). */
  workerId: string | null;
  genderRequested: 'F' | 'M' | null;
  notes: string | null;
  dutyIds: string[];
  equipmentIds: string[];
}

const ids = (body: Record<string, unknown>, key: string, what: string, max: number): string[] => {
  const raw = body?.[key];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some(x => typeof x !== 'string' || !UUID.test(x))) throw new BadRequestException(`Choose the ${what}`);
  const list = [...new Set(raw as string[])];
  if (list.length > max) throw new BadRequestException(`Choose ${max} ${what} or fewer`);
  return list;
};

/**
 * A template shift from a request body. `weekdays` (1 = Monday … 7 = Sunday) when adding (one shift per day);
 * `weekday` when changing one. Times may be left out when a shift type is chosen (its times are used).
 */
export function parseTemplateShift(body: Record<string, unknown>, many: boolean): TemplateShiftInput {
  let weekdays: number[];
  if (many) {
    const raw = body?.weekdays;
    if (!Array.isArray(raw) || !raw.length || raw.some(d => !Number.isInteger(d) || d < 1 || d > 7)) {
      throw new BadRequestException('Choose at least one day, Monday to Sunday');
    }
    weekdays = [...new Set(raw as number[])].sort();
  } else {
    weekdays = [int(body, 'weekday', 1, 7) ?? (() => { throw new BadRequestException('Choose a day, Monday to Sunday'); })()];
  }
  const needsPerson = !(bool(body, 'equipmentOnly') ?? false);
  const role = text(body, 'role', { required: needsPerson, max: 60 }) ?? 'Equipment only';
  const startTime = time(body, 'startTime', 'Start time');
  const endTime = time(body, 'endTime', 'End time');
  const breakMinutes = int(body, 'breakMinutes', 0, 240);
  const workerId = needsPerson ? uuidField(body, 'workerId', 'person') : null;
  return {
    weekdays, startTime, endTime, breakMinutes, role, needsPerson, workerId,
    areaId: uuidField(body, 'areaId', 'area'),
    shiftCodeId: uuidField(body, 'shiftCodeId', 'shift type'),
    genderRequested: needsPerson ? gender(body, 'genderRequested') : null,
    notes: text(body, 'notes', { max: 1000 }),
    dutyIds: ids(body, 'dutyIds', 'duties', 20),
    equipmentIds: ids(body, 'equipmentIds', '{equipment}', 10),
  };
}

/** Checks a template shift against the business's data and fills times from the shift type. Returns the times. */
export async function checkTemplateShift(db: PoolClient, facilityId: string, p: TemplateShiftInput): Promise<{ startTime: string; endTime: string; breakMinutes: number }> {
  if (p.areaId && !(await db.query('select 1 from areas where id = $1 and facility_id = $2', [p.areaId, facilityId])).rowCount) {
    throw new BadRequestException('Choose {an area} at this {site}');
  }
  let { startTime, endTime, breakMinutes } = p;
  if (p.shiftCodeId) {
    const sc = (await db.query<{ start: string; end: string; brk: number }>(
      `select to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as end, break_minutes as brk
         from shift_codes where id = $1 and active and (facility_id is null or facility_id = $2)`, [p.shiftCodeId, facilityId])).rows[0];
    if (!sc) throw new BadRequestException('Choose a shift type for this {site}');
    startTime ??= sc.start; endTime ??= sc.end; breakMinutes ??= sc.brk;
  }
  if (!startTime || !endTime) throw new BadRequestException('Choose a shift type, or enter start and end times');
  if (startTime === endTime) throw new BadRequestException('Start and end times must be different');
  if (p.workerId) {
    const w = (await db.query<{ status: string }>('select status from workers where id = $1', [p.workerId])).rows[0];
    if (!w || w.status !== 'active') throw new BadRequestException('Choose a usual person who is active');
  }
  if (p.dutyIds.length) {
    const n = (await db.query<{ n: number }>('select count(*)::int as n from shift_duties where id = any($1) and active', [p.dutyIds])).rows[0].n;
    if (n !== p.dutyIds.length) throw new BadRequestException('One of those duties is switched off or no longer exists');
  }
  if (p.equipmentIds.length) {
    const n = (await db.query<{ n: number }>(`select count(*)::int as n from equipment where id = any($1) and status <> 'retired'`, [p.equipmentIds])).rows[0].n;
    if (n !== p.equipmentIds.length) throw new BadRequestException('One of those is retired or no longer exists. Choose {equipment} that is still in use');
  }
  return { startTime, endTime, breakMinutes: breakMinutes ?? 0 };
}

/** Writes one template shift per weekday (with its duties and equipment). Returns the new ids. */
export async function insertTemplateShifts(
  db: PoolClient, tenantId: string, templateId: string, p: TemplateShiftInput, times: { startTime: string; endTime: string; breakMinutes: number },
  replacesId: string | null = null,
): Promise<string[]> {
  const out: string[] = [];
  for (const weekday of p.weekdays) {
    const id = (await db.query<{ id: string }>(
      `insert into roster_template_shifts(tenant_id, template_id, weekday, start_time, end_time, break_minutes, area_id, shift_code_id, role,
         needs_person, worker_id, notes, gender_requested, replaces_id)
       values ($1, $2, $3, $4::time, $5::time, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
      [tenantId, templateId, weekday, times.startTime, times.endTime, times.breakMinutes, p.areaId, p.shiftCodeId, p.role,
        p.needsPerson, p.workerId, p.notes, p.genderRequested, replacesId])).rows[0].id;
    if (p.dutyIds.length) {
      await db.query(`insert into roster_template_duties(tenant_id, template_shift_id, duty_id) select $1, $2, unnest($3::uuid[])`, [tenantId, id, p.dutyIds]);
    }
    if (p.equipmentIds.length) {
      await db.query(`insert into roster_template_equipment(tenant_id, template_shift_id, equipment_id) select $1, $2, unnest($3::uuid[])`, [tenantId, id, p.equipmentIds]);
    }
    out.push(id);
  }
  return out;
}
