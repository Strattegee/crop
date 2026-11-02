import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, date, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import { currentChecks, equipmentForShift, rankEquipment } from './equipment-data.js';
import { checkState, overallCheckState } from './equipment.js';
import { actorOf } from './publishing.js';
import { industriesOf } from '../industry/catalogue.js';
import { shiftById } from './roster.controller.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['active', 'out_of_service', 'retired'] as const;

/** A uuid field: undefined when absent, null when cleared, or the id. */
function uuidOrNull(body: Record<string, unknown>, key: string, label: string): string | null | undefined {
  if (!body || typeof body !== 'object' || !(key in body)) return undefined;
  const v = body[key];
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !UUID.test(v)) throw new BadRequestException(`Choose ${label}`);
  return v;
}

const isUnique = (e: unknown) => (e as { code?: string }).code === '23505';

const TYPE_COLS = `et.id, et.name, et.active, et.is_vehicle as "vehicle", et.operator_credential_type_id as "operatorCredentialTypeId", ct.name as "operatorCredentialName"`;
const TYPE_FROM = `equipment_types et left join credential_types ct on ct.id = et.operator_credential_type_id`;

async function checkCredentialType(db: PoolClient, id: string | null | undefined) {
  if (id && !(await db.query('select 1 from credential_types where id = $1 and active', [id])).rowCount) {
    throw new BadRequestException('Choose an operator {credential}');
  }
}

/** Kinds of equipment and the credential an operator needs (backlog item 4). */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('equipment-types')
export class EquipmentTypesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db =>
      (await db.query<{ name: string }>(`select ${TYPE_COLS} from ${TYPE_FROM} order by et.active desc, et.name`)).rows
        .map(r => ({ ...r, industries: industriesOf('equipmentType', r.name) })));
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 80 })!;
    const op = uuidOrNull(body, 'operatorCredentialTypeId', 'an operator {credential}') ?? null;
    const vehicle = bool(body, 'vehicle') ?? false;
    return withTenant(this.pool, t.tenantId, async db => {
      await checkCredentialType(db, op);
      try {
        const { id } = (await db.query<{ id: string }>(
          'insert into equipment_types(tenant_id, name, operator_credential_type_id, is_vehicle) values ($1,$2,$3,$4) returning id', [t.tenantId, name, op, vehicle])).rows[0];
        return (await db.query(`select ${TYPE_COLS} from ${TYPE_FROM} where et.id = $1`, [id])).rows[0];
      } catch (e) {
        if (isUnique(e)) throw new BadRequestException(`There is already {an equipment} type called ${name}`);
        throw e;
      }
    });
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { max: 80 });
    const op = uuidOrNull(body, 'operatorCredentialTypeId', 'an operator {credential}');
    const active = body?.active;
    if (active !== undefined && typeof active !== 'boolean') throw new BadRequestException('Active must be true or false');
    const vehicle = bool(body, 'vehicle');
    return withTenant(this.pool, t.tenantId, async db => {
      await checkCredentialType(db, op);
      try {
        const r = await db.query(
          `update equipment_types set name = coalesce($2, name), active = coalesce($3, active),
                  operator_credential_type_id = case when $4 then $5::uuid else operator_credential_type_id end,
                  is_vehicle = coalesce($6, is_vehicle)
            where id = $1`, [id, name, active ?? null, op !== undefined, op ?? null, vehicle]);
        if (!r.rowCount) throw new NotFoundException('{Equipment} type not found');
      } catch (e) {
        if (isUnique(e)) throw new BadRequestException(`There is already {an equipment} type called ${name}`);
        throw e;
      }
      return (await db.query(`select ${TYPE_COLS} from ${TYPE_FROM} where et.id = $1`, [id])).rows[0];
    });
  }
}

const EQ_COLS = `e.id, e.name, e.asset_number as "assetNumber", e.registration, e.status, e.notes,
  e.equipment_type_id as "equipmentTypeId", et.name as "typeName", ct.name as "operatorCredentialName",
  e.home_facility_id as "homeFacilityId", f.name as "homeFacilityName"`;
const EQ_FROM = `equipment e join equipment_types et on et.id = e.equipment_type_id
  left join credential_types ct on ct.id = et.operator_credential_type_id left join facilities f on f.id = e.home_facility_id`;

/** The equipment register: machines, vehicles and tools, with the dates that must be current. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('equipment')
export class EquipmentController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Adds each item's current dates and its overall state today (ok, due soon, overdue). */
  private async withChecks(db: PoolClient, tenantId: string, rows: Array<{ id: string }>) {
    if (!rows.length) return [];
    const settings = await loadSettings(db, tenantId);
    const today = todayIn(settings.timezone);
    const checks = await currentChecks(db, rows.map(r => r.id));
    return rows.map(r => {
      const list = checks.get(r.id) ?? [];
      return {
        ...r,
        checkState: overallCheckState(list, today, settings.expiringWindowDays),
        checks: list.map(c => ({ ...c, state: checkState(c.dueOn, today, settings.expiringWindowDays) })),
      };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query('status') status?: string) {
    const s = status ? oneOf({ status }, 'status', STATUSES) : null;
    return withTenant(this.pool, t.tenantId, async db => this.withChecks(db, t.tenantId, (await db.query(
      `select ${EQ_COLS} from ${EQ_FROM} where ($1::equipment_status is null and e.status <> 'retired') or e.status = $1
        order by et.name, e.name`, [s])).rows));
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const typeId = uuidOrNull(body, 'equipmentTypeId', '{an equipment} type');
    if (!typeId) throw new BadRequestException('Choose {an equipment} type');
    const name = text(body, 'name', { required: true, max: 80 })!;
    const assetNumber = text(body, 'assetNumber', { max: 40 });
    const registration = text(body, 'registration', { max: 20 })?.toUpperCase() ?? null;
    const home = uuidOrNull(body, 'homeFacilityId', 'a home site') ?? null;
    const notes = text(body, 'notes', { max: 1000 });
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from equipment_types where id = $1 and active', [typeId])).rowCount) throw new BadRequestException('Choose {an equipment} type');
      if (home && !(await db.query('select 1 from facilities where id = $1', [home])).rowCount) throw new BadRequestException('Choose a home {site}');
      try {
        const { id } = (await db.query<{ id: string }>(
          `insert into equipment(tenant_id, equipment_type_id, name, asset_number, registration, home_facility_id, notes)
           values ($1,$2,$3,$4,$5,$6,$7) returning id`, [t.tenantId, typeId, name, assetNumber, registration, home, notes])).rows[0];
        return this.one(db, t.tenantId, id);
      } catch (e) {
        if (isUnique(e)) throw new BadRequestException('There is already {equipment} with that name or asset number');
        throw e;
      }
    });
  }

  private async one(db: PoolClient, tenantId: string, id: string) {
    const row = (await db.query(`select ${EQ_COLS} from ${EQ_FROM} where e.id = $1`, [id])).rows[0];
    if (!row) throw new NotFoundException('{Equipment} not found');
    const [withChecks] = await this.withChecks(db, tenantId, [row]);
    const history = (await db.query(
      `select id, name, to_char(due_on, 'YYYY-MM-DD') as "dueOn", notes, created_at as "recordedAt", superseded_at as "supersededAt"
         from equipment_checks where equipment_id = $1 and superseded_at is not null order by superseded_at desc limit 50`, [id])).rows;
    const upcoming = (await db.query(
      `select s.id, f.name as "facilityName", s.role, s.starts_at as "startsAt", s.ends_at as "endsAt",
              to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
              to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart", to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd"
         from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
        where sa.equipment_id = $1 and sa.resource_kind = 'equipment' and sa.status in ('assigned', 'confirmed')
          and s.status <> 'cancelled' and s.ends_at > now()
        order by s.starts_at limit 50`, [id])).rows;
    return { ...withChecks, history, upcomingBookings: upcoming };
  }

  @Roles(...OFFICE_ROLES)
  @Get(':id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, db => this.one(db, t.tenantId, id));
  }

  /** Changes details or status. Upcoming bookings are kept and listed, so the office can move them. */
  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { max: 80 });
    const status = oneOf(body, 'status', STATUSES);
    const has = (k: string) => !!body && typeof body === 'object' && k in body;
    const assetNumber = text(body, 'assetNumber', { max: 40 });
    const registration = text(body, 'registration', { max: 20 })?.toUpperCase() ?? null;
    const home = uuidOrNull(body, 'homeFacilityId', 'a home site');
    const notes = text(body, 'notes', { max: 1000 });
    return withTenant(this.pool, t.tenantId, async db => {
      if (home && !(await db.query('select 1 from facilities where id = $1', [home])).rowCount) throw new BadRequestException('Choose a home {site}');
      try {
        const r = await db.query(
          `update equipment set name = coalesce($2, name), status = coalesce($3::equipment_status, status),
                  asset_number = case when $4 then $5 else asset_number end,
                  registration = case when $6 then $7 else registration end,
                  home_facility_id = case when $8 then $9::uuid else home_facility_id end,
                  notes = case when $10 then $11 else notes end, updated_at = now()
            where id = $1`,
          [id, name, status, has('assetNumber'), assetNumber, has('registration'), registration, home !== undefined, home ?? null, has('notes'), notes]);
        if (!r.rowCount) throw new NotFoundException('{Equipment} not found');
      } catch (e) {
        if (isUnique(e)) throw new BadRequestException('There is already {equipment} with that name or asset number');
        throw e;
      }
      return this.one(db, t.tenantId, id);
    });
  }

  /** Records a date that must be current (registration, service, inspection…). Replaces the current one with the same name. */
  @Roles('owner', 'admin')
  @Post(':id/checks')
  addCheck(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 60 })!;
    const dueOn = date(body, 'dueOn', { required: true })!;
    const notes = text(body, 'notes', { max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from equipment where id = $1 for update', [id])).rowCount) throw new NotFoundException('{Equipment} not found');
      await db.query(`update equipment_checks set superseded_at = now() where equipment_id = $1 and lower(name) = lower($2) and superseded_at is null`, [id, name]);
      await db.query(
        `insert into equipment_checks(tenant_id, equipment_id, name, due_on, notes, recorded_by) values ($1,$2,$3,$4,$5,$6)`,
        [t.tenantId, id, name, dueOn, notes, auth.userId]);
      return this.one(db, t.tenantId, id);
    });
  }
}

/** Booking equipment to shifts. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('shifts/:id')
export class ShiftEquipmentController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Which equipment could go on this shift: everything active, ready first, with reasons. */
  @Roles(...OFFICE_ROLES)
  @Get('equipment-candidates')
  candidates(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const shift = await shiftById(db, id);
      return { shift, candidates: rankEquipment(await equipmentForShift(db, t.tenantId, id)) };
    });
  }

  /**
   * Books equipment to a shift. Hard blocks: out of service or retired, a date overdue on the shift date,
   * already booked at an overlapping time, or the person on the shift can't operate it. Warnings are returned.
   */
  @Roles(...OFFICE_ROLES)
  @Post('equipment')
  @HttpCode(200)
  book(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const equipmentId = uuidOrNull(body, 'equipmentId', '{equipment}');
    if (!equipmentId) throw new BadRequestException('Choose {equipment}');
    return withTenant(this.pool, t.tenantId, async db => {
      // Locking the shift serialises this with assigning a person; locking the equipment stops two bookings at once.
      const shift = (await db.query<{ status: string; needs_person: boolean }>('select status, needs_person from shifts where id = $1 for update', [id])).rows[0];
      if (!shift) throw new NotFoundException('{Shift} not found');
      if (shift.status === 'cancelled') throw new ConflictException('This {shift} is cancelled');
      if (!(await db.query('select 1 from equipment where id = $1 for update', [equipmentId])).rowCount) throw new BadRequestException('Choose {equipment}');
      if ((await db.query(
        `select 1 from shift_assignments where shift_id = $1 and equipment_id = $2 and status in ('assigned', 'confirmed')`, [id, equipmentId])).rowCount) {
        throw new ConflictException('That {equipment} is already on this {shift}');
      }
      const [check] = await equipmentForShift(db, t.tenantId, id, [equipmentId]);
      if (!check.eligible) throw new ConflictException(check.blocks.map(b => b.message).join('. '));
      await db.query(
        `insert into shift_assignments(tenant_id, shift_id, resource_kind, equipment_id, status, assigned_by)
         values ($1,$2,'equipment',$3,'confirmed',$4)`, [t.tenantId, id, equipmentId, auth.userId]);
      // On an equipment-only shift, status follows the equipment.
      if (!shift.needs_person) await db.query(`update shifts set status = 'booked', updated_at = now() where id = $1`, [id]);
      return { ...(await shiftById(db, id)), warnings: check.warnings.map(w => w.message) };
    }, actorOf(auth));
  }

  @Roles(...OFFICE_ROLES)
  @Post('equipment/:equipmentId/remove')
  @HttpCode(200)
  remove(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('equipmentId', ParseUUIDPipe) equipmentId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from shifts where id = $1 for update', [id])).rowCount) throw new NotFoundException('{Shift} not found');
      const r = await db.query(
        `update shift_assignments set status = 'removed', ended_at = now()
          where shift_id = $1 and equipment_id = $2 and resource_kind = 'equipment' and status in ('assigned', 'confirmed')`, [id, equipmentId]);
      if (!r.rowCount) throw new ConflictException('That {equipment} isn\'t on this {shift}');
      // An equipment-only shift goes back to open when nothing is left on it.
      await db.query(
        `update shifts set status = 'open', updated_at = now()
          where id = $1 and not needs_person and status = 'booked'
            and not exists (select 1 from shift_assignments where shift_id = $1 and status in ('assigned', 'confirmed'))`, [id]);
      return shiftById(db, id);
    }, actorOf(auth));
  }
}
