import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { eligibilityForShift } from './eligibility-data.js';
import { closePendingOffers } from './offers-data.js';

/**
 * The changes the office makes to a shift, shared by the shift endpoints and approved change requests
 * (migration 0025), so both follow exactly the same rules. Call inside `withTenant(…, actor)`.
 */

/**
 * Puts a person on an open shift. Hard blocks: wrong role, a hard credential rule or right to work not met on
 * the shift date, already rostered at an overlapping time, or over their visa's fortnightly hours. Returns warnings.
 */
export async function assignWorker(db: PoolClient, tenantId: string, by: string | null, shiftId: string, workerId: string): Promise<string[]> {
  const shift = (await db.query<{ status: string; needs_person: boolean }>('select status, needs_person from shifts where id = $1 for update', [shiftId])).rows[0];
  if (!shift) throw new NotFoundException('{Shift} not found');
  if (shift.status === 'cancelled') throw new ConflictException('This {shift} is cancelled');
  if (!shift.needs_person) throw new ConflictException('This {shift} is for {equipment} only, so nobody can be put on it');
  if (shift.status !== 'open') throw new ConflictException('Someone is already on this {shift}. Remove them first.');
  // Locking the worker serialises assignments for one person, so two shifts can't be given to them at once.
  const worker = (await db.query<{ status: string; name: string }>(
    `select status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1 for update`,
    [workerId])).rows[0];
  if (!worker) throw new BadRequestException('Choose a person');
  if (worker.status !== 'active') throw new BadRequestException(`${worker.name} isn't active`);
  const [check] = await eligibilityForShift(db, tenantId, shiftId, [workerId]);
  if (!check.eligible) throw new ConflictException(check.blocks.map(b => b.message).join('. '));
  await db.query(`insert into shift_assignments(tenant_id, shift_id, worker_id, assigned_by) values ($1,$2,$3,$4)`, [tenantId, shiftId, workerId, by]);
  // If the shift was covering this person (migration 0035), they are back on it themselves, so it no longer covers them.
  await db.query(`update shifts set status = 'assigned', updated_at = now(),
                    covering_worker_id = case when covering_worker_id = $2 then null else covering_worker_id end where id = $1`, [shiftId, workerId]);
  await closePendingOffers(db, shiftId, 'filled', by); // filled directly, so any bank-fill offers close
  return check.warnings.map(w => w.message);
}

/** The person has agreed (or the office books them directly): assigned → booked. */
export async function confirmWorker(db: PoolClient, shiftId: string): Promise<void> {
  const r = await db.query(
    `update shift_assignments set status = 'confirmed' where shift_id = $1 and resource_kind = 'worker' and status = 'assigned'`, [shiftId]);
  if (!r.rowCount) throw new ConflictException('There is nobody waiting to confirm on this {shift}');
  await db.query(`update shifts set status = 'booked', updated_at = now() where id = $1`, [shiftId]);
}

/** Takes the person off a shift; `pulledOut` when they withdrew (Steve's purple ribbon) rather than the office removing them. */
export async function removeWorker(db: PoolClient, shiftId: string, pulledOut: boolean): Promise<void> {
  const r = await db.query(
    `update shift_assignments set status = 'removed', ended_at = now(), removed_reason = $2
      where shift_id = $1 and resource_kind = 'worker' and status in ('assigned', 'confirmed')`, [shiftId, pulledOut ? 'pulled_out' : 'office']);
  if (!r.rowCount) throw new ConflictException('Nobody is on this {shift}');
  await db.query(`update shifts set status = 'open', updated_at = now() where id = $1 and status <> 'cancelled'`, [shiftId]);
}

/** Cancels a shift with a reason: everyone comes off it and pending offers are withdrawn. */
export async function cancelShift(db: PoolClient, by: string | null, shiftId: string, reason: string): Promise<void> {
  const r = await db.query(
    `update shifts set status = 'cancelled', cancelled_reason = $2, updated_at = now() where id = $1 and status <> 'cancelled'`, [shiftId, reason]);
  if (!r.rowCount) {
    if (!(await db.query('select 1 from shifts where id = $1', [shiftId])).rowCount) throw new NotFoundException('{Shift} not found');
    throw new ConflictException('This {shift} is already cancelled');
  }
  await db.query(`update shift_assignments set status = 'removed', ended_at = now() where shift_id = $1 and status in ('assigned', 'confirmed')`, [shiftId]);
  await closePendingOffers(db, shiftId, 'withdrawn', by);
}
