import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { bool, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { addressChangeRefusal, addressLine, parseAddress, sameAddress, type AddressFields } from './addresses.js';
import { loadSettings } from './settings.js';

type Row = AddressFields & {
  id: string; workerId: string; current: boolean; replacesId: string | null; replacedAt: string | null; replacedById: string | null;
  removedAt: string | null; removedReason: string | null; createdAt: string;
};
const COLS = `a.id, a.worker_id as "workerId", a.label, a.line1, a.line2, a.suburb, a.region, a.postcode, a.country,
  a.is_current as current, a.replaces_id as "replacesId", a.replaced_at as "replacedAt", a.removed_at as "removedAt",
  a.removed_reason as "removedReason", a.created_at as "createdAt",
  (select n.id from worker_addresses n where n.replaces_id = a.id) as "replacedById"`;

/** The person's addresses: the current one, the others on the list (newest first), and earlier versions (history). */
async function listFor(db: PoolClient, tenantId: string, workerId: string) {
  const home = (await loadSettings(db, tenantId)).country;
  const rows = (await db.query<Row>(`select ${COLS} from worker_addresses a where a.worker_id = $1 order by a.created_at desc, a.id`, [workerId])).rows
    .map(r => ({ ...r, line: addressLine(r, home) }));
  const live = rows.filter(r => !r.replacedAt && !r.removedAt);
  return {
    current: live.find(r => r.current) ?? null,
    others: live.filter(r => !r.current),
    earlier: rows.filter(r => r.replacedAt || r.removedAt).map(r => ({ ...r, ended: r.replacedAt ? 'corrected' as const : 'removed' as const })),
  };
}

/** Locks the person (so two changes can't both make an address current) and checks they are one of ours. */
async function lockWorker(db: PoolClient, workerId: string) {
  const w = (await db.query<{ status: string }>('select status from workers where id = $1 for update', [workerId])).rows[0];
  if (!w) throw new NotFoundException('Person not found');
  if (w.status === 'agency') throw new BadRequestException("An agency's people are the agency's to keep details for");
}

async function addressFor(db: PoolClient, id: string) {
  const a = (await db.query<Row>(`select ${COLS} from worker_addresses a where a.id = $1`, [id])).rows[0];
  if (!a) throw new NotFoundException('Address not found');
  await lockWorker(db, a.workerId);
  // Read again under the lock.
  return (await db.query<Row>(`select ${COLS} from worker_addresses a where a.id = $1`, [id])).rows[0];
}

const clearCurrent = (db: PoolClient, workerId: string) =>
  db.query('update worker_addresses set is_current = false where worker_id = $1 and is_current', [workerId]);

/**
 * A person's addresses (David, 3 Nov 2026, answer 5: "never overwrite"; previous home addresses kept; several
 * addresses with one current). Office roles. Nothing is edited or deleted: a correction replaces a row with a new
 * one, removing marks it, and every step is in the audit log.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class AddressesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get('workers/:id/addresses')
  list(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) workerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query(`select 1 from workers where id = $1 and status <> 'agency'`, [workerId])).rowCount) throw new NotFoundException('Person not found');
      return listFor(db, t.tenantId, workerId);
    });
  }

  /** `{ label?, line1, line2?, suburb?, state?, postcode?, country?, current? }`. Their first address is current. */
  @Roles(...OFFICE_ROLES)
  @Post('workers/:id/addresses')
  add(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const makeCurrent = bool(body, 'current');
    return withTenant(this.pool, t.tenantId, async db => {
      await lockWorker(db, workerId);
      const parsed = parseAddress(body, (await loadSettings(db, t.tenantId)).country);
      if ('problem' in parsed) throw new BadRequestException(parsed.problem);
      const hasCurrent = !!(await db.query('select 1 from worker_addresses where worker_id = $1 and is_current', [workerId])).rowCount;
      const current = makeCurrent ?? !hasCurrent;
      if (current) await clearCurrent(db, workerId);
      await insert(db, t.tenantId, workerId, parsed.address, current, null);
      return listFor(db, t.tenantId, workerId);
    });
  }

  /** Corrects an address (same fields as adding): a new version replaces it and keeps its place; the old one is kept. */
  @Roles(...OFFICE_ROLES)
  @Post('worker-addresses/:id/correct')
  @HttpCode(200)
  correct(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return withTenant(this.pool, t.tenantId, async db => {
      const a = await addressFor(db, id);
      const refusal = addressChangeRefusal(a);
      if (refusal) throw new ConflictException(refusal);
      const merged = { ...pick(a), ...body };
      if ('region' in body && !('state' in body)) merged.state = body.region;
      const parsed = parseAddress(merged, (await loadSettings(db, t.tenantId)).country);
      if ('problem' in parsed) throw new BadRequestException(parsed.problem);
      if (!sameAddress(parsed.address, a)) {
        await db.query('update worker_addresses set is_current = false, replaced_at = now() where id = $1', [id]);
        await insert(db, t.tenantId, a.workerId, parsed.address, a.current, id);
      }
      return listFor(db, t.tenantId, a.workerId);
    });
  }

  /** Makes this address the current one; the one it takes over from stays on the list. */
  @Roles(...OFFICE_ROLES)
  @Post('worker-addresses/:id/current')
  @HttpCode(200)
  makeCurrent(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const a = await addressFor(db, id);
      const refusal = addressChangeRefusal(a);
      if (refusal) throw new ConflictException(refusal);
      if (!a.current) {
        await clearCurrent(db, a.workerId);
        await db.query('update worker_addresses set is_current = true where id = $1', [id]);
      }
      return listFor(db, t.tenantId, a.workerId);
    });
  }

  /** `{ reason? }`. Takes an address off the list (kept on file). Removing the current one leaves none current. */
  @Roles(...OFFICE_ROLES)
  @Post('worker-addresses/:id/remove')
  @HttpCode(200)
  remove(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body ?? {}, 'reason', { max: 200 });
    return withTenant(this.pool, t.tenantId, async db => {
      const a = await addressFor(db, id);
      const refusal = addressChangeRefusal(a);
      if (refusal) throw new ConflictException(refusal);
      await db.query('update worker_addresses set is_current = false, removed_at = now(), removed_reason = $2 where id = $1', [id, reason]);
      return listFor(db, t.tenantId, a.workerId);
    });
  }
}

/** The stored fields as a request body, so a correction may send only what changes. */
const pick = (a: AddressFields): Record<string, unknown> =>
  ({ label: a.label, line1: a.line1, line2: a.line2, suburb: a.suburb, state: a.region, postcode: a.postcode, country: a.country });

async function insert(db: PoolClient, tenantId: string, workerId: string, a: AddressFields, current: boolean, replaces: string | null) {
  await db.query(
    `insert into worker_addresses(tenant_id, worker_id, label, line1, line2, suburb, region, postcode, country, is_current, replaces_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [tenantId, workerId, a.label, a.line1, a.line2, a.suburb, a.region, a.postcode, a.country, current, replaces]);
}

