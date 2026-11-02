/**
 * Creating shifts, shared by `POST /shifts` and client orders (`POST /client-orders`): the body is checked by
 * `parseShiftRequest` (no database), then `insertShifts` checks it against the business's data and inserts the
 * shifts (one position each, `quantity` per day) inside the caller's transaction.
 */
import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { bool, date, gender, int, text } from '../common/validate.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_SHIFTS_PER_REQUEST = 400;
export const MAX_RANGE_DAYS = 92;

export function time(body: Record<string, unknown>, key: string, label: string): string | null {
  const v = text(body, key, { max: 5 });
  if (v === null) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new BadRequestException(`${label} must be a time like 07:00`);
  return v;
}

export function uuidField(body: Record<string, unknown>, key: string, label: string, required = false): string | null {
  const v = text(body, key, { max: 40, required });
  if (v === null) return null;
  if (!UUID.test(v)) throw new BadRequestException(`Choose a ${label}`);
  return v;
}

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

export interface ShiftRequest {
  body: Record<string, unknown>;
  facilityId: string;
  areaId: string | null;
  shiftCodeId: string | null;
  equipmentOnly: boolean;
  role: string;
  notes: string | null;
  quantity: number;
  dates: string[];
  dutyIds: string[];
  genderRequested: 'F' | 'M' | null;
}

/** Checks a request for shifts without the database (the same checks, in the same order, as `POST /shifts` always made). */
export function parseShiftRequest(body: Record<string, unknown>): ShiftRequest {
  const facilityId = uuidField(body, 'facilityId', 'site', true)!;
  const areaId = uuidField(body, 'areaId', 'area');
  const shiftCodeId = uuidField(body, 'shiftCodeId', 'shift code');
  // Equipment only: booked without a person (e.g. dry hire, where the client supplies the operator).
  const equipmentOnly = bool(body, 'equipmentOnly') ?? false;
  const role = text(body, 'role', { required: !equipmentOnly, max: 60 }) ?? 'Equipment only';
  const notes = text(body, 'notes', { max: 1000 });
  const quantity = int(body, 'quantity', 1, 20) ?? 1;
  const single = date(body, 'date');
  const startDate = single ?? date(body, 'startDate', { required: true })!;
  const endDate = single ?? date(body, 'endDate', { required: true })!;
  if (endDate < startDate) throw new BadRequestException('The end date is before the start date');
  if (daysBetween(startDate, endDate) > MAX_RANGE_DAYS) throw new BadRequestException(`Choose ${MAX_RANGE_DAYS} days or fewer`);
  const weekdaysRaw = body?.weekdays;
  let weekdays: number[] | null = null;
  if (weekdaysRaw !== undefined && weekdaysRaw !== null) {
    if (!Array.isArray(weekdaysRaw) || weekdaysRaw.some(d => !Number.isInteger(d) || d < 1 || d > 7)) {
      throw new BadRequestException('Days must be a list of weekdays, 1 (Monday) to 7 (Sunday)');
    }
    weekdays = [...new Set(weekdaysRaw as number[])];
  }
  const dates: string[] = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) if (!weekdays || weekdays.includes(isoWeekday(d))) dates.push(d);
  if (!dates.length) throw new BadRequestException('No dates match the days chosen');
  if (dates.length * quantity > MAX_SHIFTS_PER_REQUEST) throw new BadRequestException(`That would create more than ${MAX_SHIFTS_PER_REQUEST} {shifts}`);
  // Shift duties (migration 0029) to put on every shift created, e.g. "Serves alcohol".
  const dutiesRaw = body?.dutyIds;
  if (dutiesRaw !== undefined && dutiesRaw !== null && (!Array.isArray(dutiesRaw) || dutiesRaw.some(x => typeof x !== 'string' || !UUID.test(x)))) {
    throw new BadRequestException('Choose the duties for these {shifts}');
  }
  const dutyIds = [...new Set((dutiesRaw as string[] | null | undefined) ?? [])];
  if (dutyIds.length > 20) throw new BadRequestException('Choose 20 duties or fewer');
  // Gender requested by whoever asked for the shift (David, 30 Oct): a warning for anyone else, never a block.
  const genderRequested = equipmentOnly ? null : gender(body, 'genderRequested');
  return { body, facilityId, areaId, shiftCodeId, equipmentOnly, role, notes, quantity, dates, dutyIds, genderRequested };
}

/**
 * Inserts the shifts asked for (inside the caller's transaction, which should carry the actor so the shift log
 * records who). `clientOrderId` links each shift to the client order it came from (migration 0068).
 */
export async function insertShifts(db: PoolClient, tenantId: string, userId: string | null, r: ShiftRequest, clientOrderId: string | null = null) {
  const { body, facilityId, areaId, shiftCodeId } = r;
  const facility = (await db.query<{ timezone: string }>('select timezone from facilities where id = $1', [facilityId])).rows[0];
  if (!facility) throw new BadRequestException('Choose {a site}');
  if (areaId && !(await db.query('select 1 from areas where id = $1 and facility_id = $2', [areaId, facilityId])).rowCount) {
    throw new BadRequestException('Choose {an area} at this {site}');
  }
  let startTime = time(body, 'startTime', 'Start time');
  let endTime = time(body, 'endTime', 'End time');
  let breakMinutes = int(body, 'breakMinutes', 0, 240);
  if (shiftCodeId) {
    const sc = (await db.query<{ start: string; end: string; brk: number }>(
      `select to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as end, break_minutes as brk
         from shift_codes where id = $1 and active and (facility_id is null or facility_id = $2)`, [shiftCodeId, facilityId])).rows[0];
    if (!sc) throw new BadRequestException('Choose a shift code for this {site}');
    startTime ??= sc.start; endTime ??= sc.end; breakMinutes ??= sc.brk;
  }
  if (!startTime || !endTime) throw new BadRequestException('Choose a shift code, or enter start and end times');
  if (startTime === endTime) throw new BadRequestException('Start and end times must be different');
  const overnight = endTime < startTime;
  const ids = (await db.query<{ id: string }>(
    `insert into shifts(tenant_id, facility_id, area_id, shift_code_id, role, starts_at, ends_at, break_minutes, notes, created_by, needs_person, gender_requested, client_order_id)
     select $1, $2, $3, $4, $5,
            (d + $7::time) at time zone $6,
            (d + $9::int + $8::time) at time zone $6,
            $10, $11, $12, $15, $16, $17
       from unnest($13::date[]) d, generate_series(1, $14::int)
     returning id`,
    [tenantId, facilityId, areaId, shiftCodeId, r.role, facility.timezone, startTime, endTime, overnight ? 1 : 0,
      breakMinutes ?? 0, r.notes, userId, r.dates, r.quantity, !r.equipmentOnly, r.genderRequested, clientOrderId],
  )).rows.map(x => x.id);
  if (r.dutyIds.length) {
    const ok = (await db.query<{ n: number }>('select count(*)::int as n from shift_duties where id = any($1) and active', [r.dutyIds])).rows[0].n;
    if (ok !== r.dutyIds.length) throw new BadRequestException('One of those duties is switched off or no longer exists');
    await db.query(
      `insert into shift_duty_links(tenant_id, shift_id, duty_id) select $1, s, d from unnest($2::uuid[]) s, unnest($3::uuid[]) d`,
      [tenantId, ids, r.dutyIds]);
  }
  return { created: ids.length, ids };
}
