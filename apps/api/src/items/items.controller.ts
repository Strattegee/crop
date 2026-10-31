import {
  BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, int, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { industriesOf } from '../industry/catalogue.js';
import {
  ITEM_CATEGORIES, isLow, returnBlock, roundQty, summariseUsage, takeBlock, type MovementKind, type MovementLine,
  transferBlock,
} from './items.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CENTS = 100_000_000;
const isUnique = (e: unknown) => (e as { code?: string }).code === '23505';

/** A uuid field: undefined when absent, null when cleared, or the id. */
function uuidOrNull(body: Record<string, unknown>, key: string, label: string): string | null | undefined {
  if (!body || typeof body !== 'object' || !(key in body)) return undefined;
  const v = body[key];
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !UUID.test(v)) throw new BadRequestException(`Choose ${label}`);
  return v;
}

/** A positive quantity with up to 3 decimal places (or zero, when allowed, for a stocktake). */
function quantity(body: Record<string, unknown>, key: string, label: string, opts: { required?: boolean; allowZero?: boolean } = {}): number | null {
  const v = body?.[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new BadRequestException(`${label} is required`);
    return null;
  }
  const n = typeof v === 'number' ? v : NaN;
  const min = opts.allowZero ? 0 : 0.001;
  if (!Number.isFinite(n) || n < min || n > 1_000_000 || roundQty(n) !== n) {
    throw new BadRequestException(`${label} must be a number${opts.allowZero ? '' : ' above 0'}, up to 3 decimal places`);
  }
  return n;
}

const ITEM_COLS = `i.id, i.name, i.category, i.unit, i.sku, i.unit_cost_cents as "unitCostCents", i.charge_cents as "chargeCents",
  i.tracks_stock as "tracksStock", i.reorder_level::float8 as "reorderLevel", i.active`;

interface ItemRow { id: string; name: string; unit: string; unitCostCents: number; chargeCents: number | null; tracksStock: boolean; active: boolean }

async function lockItem(db: PoolClient, id: string): Promise<ItemRow> {
  // Locking the item serialises every stock movement for it, so two issues can't both take the last one.
  const item = (await db.query<ItemRow>(`select ${ITEM_COLS} from items i where i.id = $1 for update`, [id])).rows[0];
  if (!item) throw new NotFoundException('Item not found');
  return item;
}

async function onHand(db: PoolClient, itemId: string, facilityId: string): Promise<number> {
  return (await db.query<{ q: number }>(
    'select coalesce(sum(quantity), 0)::float8 as q from stock_movements where item_id = $1 and facility_id = $2', [itemId, facilityId])).rows[0].q;
}

async function siteName(db: PoolClient, facilityId: string | null): Promise<string | null> {
  if (!facilityId) return null;
  const f = (await db.query<{ name: string }>('select name from facilities where id = $1', [facilityId])).rows[0];
  if (!f) throw new BadRequestException('Choose a site');
  return f.name;
}

async function shiftFor(db: PoolClient, shiftId: string | null) {
  if (!shiftId) return null;
  const s = (await db.query<{ facility_id: string; status: string }>('select facility_id, status from shifts where id = $1', [shiftId])).rows[0];
  if (!s) throw new BadRequestException('Choose a shift');
  return s;
}

async function workerName(db: PoolClient, workerId: string | null): Promise<string | null> {
  if (!workerId) return null;
  const w = (await db.query<{ name: string }>(
    `select coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1`, [workerId])).rows[0];
  if (!w) throw new BadRequestException('Choose a person');
  return w.name;
}

const MOVEMENT_COLS = `m.id, m.kind, m.quantity::float8 as quantity, m.facility_id as "facilityId", f.name as "facilityName",
  m.worker_id as "workerId", case when w.id is null then null else coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name end as "workerName",
  m.shift_id as "shiftId", m.transfer_id as "transferId", m.unit_cost_cents as "unitCostCents", m.charge_cents as "chargeCents", m.notes, m.created_at as "recordedAt"`;
const MOVEMENT_FROM = `stock_movements m left join facilities f on f.id = m.facility_id left join workers w on w.id = m.worker_id`;

/** The catalogue of items and consumables (PPE, fuel, sundries) and their stock movements. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('items')
export class ItemsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query('all') all?: string) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select ${ITEM_COLS}, (select coalesce(sum(quantity), 0)::float8 from stock_movements m where m.item_id = i.id and i.tracks_stock and m.facility_id is not null) as "onHand"
         from items i where $1 or i.active order by i.active desc, i.category, i.name`, [all === 'true'])).rows
      .map((r: { name: string }) => ({ ...r, industries: industriesOf('item', r.name) })));
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 80 })!;
    const category = oneOf(body, 'category', ITEM_CATEGORIES) ?? 'other';
    const unit = text(body, 'unit', { max: 20 }) ?? 'each';
    const sku = text(body, 'sku', { max: 40 });
    const unitCostCents = int(body, 'unitCostCents', 0, MAX_CENTS) ?? 0;
    const chargeCents = int(body, 'chargeCents', 0, MAX_CENTS);
    const tracksStock = bool(body, 'tracksStock') ?? true;
    const reorderLevel = quantity(body, 'reorderLevel', 'Reorder level', { allowZero: true });
    return withTenant(this.pool, t.tenantId, async db => {
      try {
        const { id } = (await db.query<{ id: string }>(
          `insert into items(tenant_id, name, category, unit, sku, unit_cost_cents, charge_cents, tracks_stock, reorder_level)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [t.tenantId, name, category, unit, sku, unitCostCents, chargeCents, tracksStock, reorderLevel])).rows[0];
        return this.one(db, id);
      } catch (e) {
        if (isUnique(e)) throw new BadRequestException('There is already an item with that name or SKU');
        throw e;
      }
    });
  }

  /** Changes details. A new cost or charge applies from now on; movements already recorded keep theirs. */
  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const has = (k: string) => !!body && typeof body === 'object' && k in body;
    const name = text(body, 'name', { max: 80 });
    const category = oneOf(body, 'category', ITEM_CATEGORIES);
    const unit = text(body, 'unit', { max: 20 });
    const sku = text(body, 'sku', { max: 40 });
    const unitCostCents = int(body, 'unitCostCents', 0, MAX_CENTS);
    const chargeCents = int(body, 'chargeCents', 0, MAX_CENTS);
    const tracksStock = bool(body, 'tracksStock');
    const reorderLevel = quantity(body, 'reorderLevel', 'Reorder level', { allowZero: true });
    const active = bool(body, 'active');
    return withTenant(this.pool, t.tenantId, async db => {
      try {
        const r = await db.query(
          `update items set name = coalesce($2, name), category = coalesce($3, category), unit = coalesce($4, unit),
                  sku = case when $5 then $6 else sku end, unit_cost_cents = coalesce($7, unit_cost_cents),
                  charge_cents = case when $8 then $9::int else charge_cents end, tracks_stock = coalesce($10, tracks_stock),
                  reorder_level = case when $11 then $12::numeric else reorder_level end, active = coalesce($13, active), updated_at = now()
            where id = $1`,
          [id, name, category, unit, has('sku'), sku, unitCostCents, has('chargeCents'), chargeCents, tracksStock, has('reorderLevel'), reorderLevel, active]);
        if (!r.rowCount) throw new NotFoundException('Item not found');
      } catch (e) {
        if (isUnique(e)) throw new BadRequestException('There is already an item with that name or SKU');
        throw e;
      }
      return this.one(db, id);
    });
  }

  private async one(db: PoolClient, id: string) {
    const item = (await db.query(`select ${ITEM_COLS} from items i where i.id = $1`, [id])).rows[0] as (ItemRow & { reorderLevel: number | null }) | undefined;
    if (!item) throw new NotFoundException('Item not found');
    const sites = item.tracksStock ? (await db.query<{ facilityId: string; facilityName: string; onHand: number }>(
      `select m.facility_id as "facilityId", f.name as "facilityName", sum(m.quantity)::float8 as "onHand"
         from stock_movements m join facilities f on f.id = m.facility_id
        where m.item_id = $1 group by m.facility_id, f.name order by f.name`, [id])).rows : [];
    const movements = (await db.query(
      `select ${MOVEMENT_COLS} from ${MOVEMENT_FROM} where m.item_id = $1 order by m.created_at desc limit 100`, [id])).rows;
    return {
      ...item,
      onHand: sites.reduce((s, x) => roundQty(s + x.onHand), 0),
      sites: sites.map(s => ({ ...s, low: isLow(s.onHand, item.reorderLevel) })),
      movements,
    };
  }

  @Roles(...OFFICE_ROLES)
  @Get(':id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, db => this.one(db, id));
  }

  private async record(db: PoolClient, tenantId: string, userId: string, item: ItemRow, m: {
    kind: MovementKind; quantity: number; facilityId: string | null; workerId?: string | null; shiftId?: string | null;
    unitCostCents?: number; chargeCents?: number | null; notes: string | null;
  }) {
    await db.query(
      `insert into stock_movements(tenant_id, item_id, facility_id, kind, quantity, worker_id, shift_id, unit_cost_cents, charge_cents, notes, recorded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tenantId, item.id, m.facilityId, m.kind, m.quantity, m.workerId ?? null, m.shiftId ?? null,
        m.unitCostCents ?? item.unitCostCents, m.chargeCents !== undefined ? m.chargeCents : item.chargeCents, m.notes, userId]);
    return this.one(db, item.id);
  }

  /** Stock arriving at a site. A unit cost given here becomes the item's cost from now on. */
  @Roles(...OFFICE_ROLES)
  @Post(':id/receive')
  receive(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const facilityId = uuidOrNull(body, 'facilityId', 'a site');
    if (!facilityId) throw new BadRequestException('Choose a site');
    const qty = quantity(body, 'quantity', 'Quantity', { required: true })!;
    const unitCostCents = int(body, 'unitCostCents', 0, MAX_CENTS);
    const notes = text(body, 'notes', { max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      const item = await lockItem(db, id);
      if (!item.tracksStock) throw new BadRequestException(`Stock isn't counted for ${item.name}; record its use on a shift or person instead`);
      await siteName(db, facilityId);
      if (unitCostCents !== null && unitCostCents !== item.unitCostCents) {
        await db.query('update items set unit_cost_cents = $2, updated_at = now() where id = $1', [id, unitCostCents]);
        item.unitCostCents = unitCostCents;
      }
      return this.record(db, t.tenantId, auth.userId, item, { kind: 'received', quantity: qty, facilityId, notes });
    });
  }

  /**
   * Issues an item to a person (optionally for a shift), or uses it on a shift. Stock comes from the given site,
   * or the shift's site. Refused when the site doesn't have enough (counted items only) or the shift is cancelled.
   */
  @Roles(...OFFICE_ROLES)
  @Post(':id/issue')
  issue(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const qty = quantity(body, 'quantity', 'Quantity', { required: true })!;
    const workerId = uuidOrNull(body, 'workerId', 'a person') ?? null;
    const shiftId = uuidOrNull(body, 'shiftId', 'a shift') ?? null;
    const given = uuidOrNull(body, 'facilityId', 'a site') ?? null;
    const notes = text(body, 'notes', { max: 500 });
    if (!workerId && !shiftId) throw new BadRequestException('Choose a person or a shift');
    return withTenant(this.pool, t.tenantId, async db => {
      const item = await lockItem(db, id);
      if (!item.active) throw new ConflictException(`${item.name} is no longer in use`);
      await workerName(db, workerId);
      const shift = await shiftFor(db, shiftId);
      if (shift?.status === 'cancelled') throw new ConflictException('This shift is cancelled');
      const facilityId = given ?? shift?.facility_id ?? null;
      if (item.tracksStock && !facilityId) throw new BadRequestException('Choose the site the stock comes from');
      const site = await siteName(db, facilityId);
      const block = takeBlock({
        itemName: item.name, unit: item.unit, tracksStock: item.tracksStock, siteName: site, quantity: qty,
        onHand: item.tracksStock && facilityId ? await onHand(db, id, facilityId) : 0,
      });
      if (block) throw new ConflictException(block);
      return this.record(db, t.tenantId, auth.userId, item, {
        kind: workerId ? 'issued' : 'used', quantity: -qty, facilityId, workerId, shiftId, notes,
      });
    });
  }

  /** Items coming back from a person or a shift, into a site's stock. No more than went out. */
  @Roles(...OFFICE_ROLES)
  @Post(':id/return')
  giveBack(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const qty = quantity(body, 'quantity', 'Quantity', { required: true })!;
    const workerId = uuidOrNull(body, 'workerId', 'a person') ?? null;
    const shiftId = uuidOrNull(body, 'shiftId', 'a shift') ?? null;
    const given = uuidOrNull(body, 'facilityId', 'a site') ?? null;
    const notes = text(body, 'notes', { max: 500 });
    if (!workerId && !shiftId) throw new BadRequestException('Choose a person or a shift');
    return withTenant(this.pool, t.tenantId, async db => {
      const item = await lockItem(db, id);
      const who = (await workerName(db, workerId)) ?? 'this shift';
      const shift = await shiftFor(db, shiftId);
      // What went out to this person (on this shift, if given), or used on this shift.
      const out = (await db.query<{ outstanding: number; cost: number | null; charge: number | null; facility: string | null }>(
        `select -coalesce(sum(quantity), 0)::float8 as outstanding,
                (array_agg(unit_cost_cents order by created_at desc) filter (where quantity < 0))[1] as cost,
                (array_agg(charge_cents order by created_at desc) filter (where quantity < 0))[1] as charge,
                (array_agg(facility_id order by created_at desc) filter (where quantity < 0))[1] as facility
           from stock_movements where item_id = $1 and kind in ('issued', 'used', 'returned')
            and case when $2::uuid is null then worker_id is null and shift_id = $3
                     else worker_id = $2 and ($3::uuid is null or shift_id = $3) end`,
        [id, workerId, shiftId])).rows[0];
      const block = returnBlock(out.outstanding, qty, item.name, who);
      if (block) throw new ConflictException(block);
      const facilityId = given ?? shift?.facility_id ?? out.facility;
      await siteName(db, facilityId);
      if (item.tracksStock && !facilityId) throw new BadRequestException('Choose the site it is returned to');
      // Returns are valued at what was charged going out, so a shift's net cost comes back to what was kept.
      return this.record(db, t.tenantId, auth.userId, item, {
        kind: 'returned', quantity: qty, facilityId, workerId, shiftId, notes,
        unitCostCents: out.cost ?? item.unitCostCents, chargeCents: out.cost === null ? item.chargeCents : out.charge,
      });
    });
  }

  /**
   * Moves counted stock from one site to another: two ledger rows sharing a transfer id, at the item's cost now.
   * Refused when the sites are the same or the first site doesn't have enough.
   */
  @Roles(...OFFICE_ROLES)
  @Post(':id/transfer')
  transfer(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const fromId = uuidOrNull(body, 'fromFacilityId', 'the site it leaves');
    const toId = uuidOrNull(body, 'toFacilityId', 'the site it goes to');
    if (!fromId) throw new BadRequestException('Choose the site the stock leaves');
    if (!toId) throw new BadRequestException('Choose the site the stock goes to');
    const qty = quantity(body, 'quantity', 'Quantity', { required: true })!;
    const notes = text(body, 'notes', { max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      const item = await lockItem(db, id);
      const problem = transferBlock({ itemName: item.name, tracksStock: item.tracksStock, fromId, toId });
      if (problem) throw new BadRequestException(problem);
      const from = await siteName(db, fromId);
      await siteName(db, toId);
      const block = takeBlock({ itemName: item.name, unit: item.unit, tracksStock: true, siteName: from, quantity: qty, onHand: await onHand(db, id, fromId) });
      if (block) throw new ConflictException(block);
      await db.query(
        `with t as (select gen_random_uuid() as id)
         insert into stock_movements(tenant_id, item_id, facility_id, kind, quantity, transfer_id, unit_cost_cents, charge_cents, notes, recorded_by)
         select $1, $2, f, 'transferred', q, t.id, $3, $4, $5, $6 from t, (values ($7::uuid, -$9::numeric), ($8::uuid, $9::numeric)) v(f, q)`,
        [t.tenantId, id, item.unitCostCents, item.chargeCents, notes, auth.userId, fromId, toId, qty]);
      return this.one(db, id);
    });
  }

  /** A stocktake: records the counted quantity at a site, as an adjustment from what CROP expected. */
  @Roles('owner', 'admin')
  @Post(':id/count')
  count(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const facilityId = uuidOrNull(body, 'facilityId', 'a site');
    if (!facilityId) throw new BadRequestException('Choose a site');
    const counted = quantity(body, 'quantity', 'Quantity', { required: true, allowZero: true })!;
    const notes = text(body, 'notes', { max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      const item = await lockItem(db, id);
      if (!item.tracksStock) throw new BadRequestException(`Stock isn't counted for ${item.name}`);
      await siteName(db, facilityId);
      const diff = roundQty(counted - (await onHand(db, id, facilityId)));
      if (diff === 0) return this.one(db, id);
      return this.record(db, t.tenantId, auth.userId, item, { kind: 'adjusted', quantity: diff, facilityId, notes });
    });
  }
}

/** Stock on hand per site, for counted items. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('stock')
export class StockController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query('facilityId') facilityId?: string) {
    if (facilityId && !UUID.test(facilityId)) throw new BadRequestException('Choose a site');
    return withTenant(this.pool, t.tenantId, async db => {
      const rows = (await db.query<{ itemId: string; name: string; category: string; unit: string; facilityId: string; facilityName: string; onHand: number; reorderLevel: number | null }>(
        `select i.id as "itemId", i.name, i.category, i.unit, f.id as "facilityId", f.name as "facilityName",
                coalesce(sum(m.quantity), 0)::float8 as "onHand", i.reorder_level::float8 as "reorderLevel"
           from items i join stock_movements m on m.item_id = i.id join facilities f on f.id = m.facility_id
          where i.tracks_stock and i.active and ($1::uuid is null or f.id = $1)
          group by i.id, f.id order by f.name, i.category, i.name`, [facilityId ?? null])).rows;
      return rows.map(r => ({ ...r, low: isLow(r.onHand, r.reorderLevel) }));
    });
  }
}

async function usage(db: PoolClient, where: string, id: string, byPerson = false) {
  const lines = (await db.query<MovementLine>(
    `select m.item_id as "itemId", i.name, i.unit, m.quantity::float8 as quantity, m.unit_cost_cents as "unitCostCents", m.charge_cents as "chargeCents",
            m.worker_id as "workerId", case when w.id is null then null else coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name end as "workerName"
       from stock_movements m join items i on i.id = m.item_id left join workers w on w.id = m.worker_id
      where ${where} = $1 and m.kind in ('issued', 'used', 'returned') order by m.created_at`, [id])).rows;
  return summariseUsage(lines, { byPerson });
}

/**
 * What a shift used: items used on it or issued for it, net of returns, with cost and the charge to the client.
 * `?byPerson=true` gives one line per item and holder (`workerId`/`workerName`, null = used on the shift).
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('shifts/:id/items')
export class ShiftItemsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Query('byPerson') byPerson?: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from shifts where id = $1', [id])).rowCount) throw new NotFoundException('Shift not found');
      // byPerson=true splits each item by who holds it (the shift panel uses it to offer returns).
      return usage(db, 'm.shift_id', id, byPerson === 'true');
    });
  }
}

/** What a person has been issued and not returned (PPE, tools), with cost. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('workers/:id/items')
export class WorkerItemsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from workers where id = $1', [id])).rowCount) throw new NotFoundException('Person not found');
      return usage(db, 'm.worker_id', id);
    });
  }
}
