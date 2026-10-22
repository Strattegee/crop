import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { bool, isTimeZone, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { STATE_TIMEZONES } from '../clients/abn.js';

const STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;
const COLS = `f.id, f.name, f.client_id as "clientId", c.name as "clientName", f.address_line as "addressLine", f.suburb, f.state,
  f.postcode, f.timezone, f.phone, f.parking_notes as "parkingNotes", f.entry_notes as "entryNotes", f.active`;

function postcode(body: Record<string, unknown>) {
  const v = text(body, 'postcode', { max: 4 });
  if (v !== null && !/^\d{4}$/.test(v)) throw new BadRequestException('Postcode must be 4 digits');
  return v;
}

/** The time zone comes from the state (ORG-3), unless one is given (e.g. Broken Hill uses Adelaide time). */
function timezoneFor(body: Record<string, unknown>, state: string | null): string | null {
  const tz = text(body, 'timezone', { max: 60 });
  if (tz) {
    if (!isTimeZone(tz)) throw new BadRequestException('Time zone is not valid');
    return tz;
  }
  return state ? STATE_TIMEZONES[state] : null;
}

async function clientExists(db: PoolClient, id: string | null) {
  if (id === null) return;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await db.query('select 1 from clients where id = $1', [id])).rowCount) {
    throw new BadRequestException('Choose a client');
  }
}

/** Facilities (sites) belong to clients and contain areas (spec ORG-3, ORG-4). */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('facilities')
export class FacilitiesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query('clientId') clientId?: string) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select ${COLS} from facilities f left join clients c on c.id = f.client_id
        where ($1::uuid is null or f.client_id = $1) order by f.active desc, f.name`,
      [clientId && /^[0-9a-f-]{36}$/i.test(clientId) ? clientId : null],
    )).rows);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 200 });
    const state = oneOf(body, 'state', STATES);
    const timezone = timezoneFor(body, state) ?? 'Australia/Melbourne';
    const clientId = text(body, 'clientId', { max: 40 });
    return withTenant(this.pool, t.tenantId, async db => {
      await clientExists(db, clientId);
      const row = (await db.query<{ id: string }>(
        `insert into facilities(tenant_id, client_id, name, address_line, suburb, state, postcode, timezone, phone, parking_notes, entry_notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [t.tenantId, clientId, name, text(body, 'addressLine', { max: 200 }), text(body, 'suburb', { max: 100 }), state, postcode(body),
          timezone, text(body, 'phone', { max: 30 }), text(body, 'parkingNotes', { max: 1000 }), text(body, 'entryNotes', { max: 1000 })],
      )).rows[0];
      return (await db.query(`select ${COLS} from facilities f left join clients c on c.id = f.client_id where f.id = $1`, [row.id])).rows[0];
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get(':id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const f = (await db.query(`select ${COLS} from facilities f left join clients c on c.id = f.client_id where f.id = $1`, [id])).rows[0];
      if (!f) throw new NotFoundException('facility not found');
      const areas = (await db.query(`select id, name, specialty, active from areas where facility_id = $1 order by active desc, name`, [id])).rows;
      return { ...f, areas };
    });
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const has = (k: string) => Boolean(body && k in body);
    const state = oneOf(body, 'state', STATES);
    const tz = has('timezone') || state ? timezoneFor(body, state) : null;
    const clientId = text(body, 'clientId', { max: 40 });
    return withTenant(this.pool, t.tenantId, async db => {
      if (has('clientId')) await clientExists(db, clientId);
      const r = await db.query(
        `update facilities set
           name = coalesce($2, name), client_id = case when $3 then $4::uuid else client_id end,
           address_line = case when $5 then $6 else address_line end, suburb = case when $7 then $8 else suburb end,
           state = case when $9 then $10 else state end, postcode = case when $11 then $12 else postcode end,
           timezone = coalesce($13, timezone), phone = case when $14 then $15 else phone end,
           parking_notes = case when $16 then $17 else parking_notes end, entry_notes = case when $18 then $19 else entry_notes end,
           active = coalesce($20, active)
         where id = $1`,
        [id, text(body, 'name', { max: 200 }), has('clientId'), clientId, has('addressLine'), text(body, 'addressLine', { max: 200 }),
          has('suburb'), text(body, 'suburb', { max: 100 }), has('state'), state, has('postcode'), postcode(body), tz,
          has('phone'), text(body, 'phone', { max: 30 }), has('parkingNotes'), text(body, 'parkingNotes', { max: 1000 }),
          has('entryNotes'), text(body, 'entryNotes', { max: 1000 }), bool(body, 'active')],
      );
      if (!r.rowCount) throw new NotFoundException('facility not found');
      return (await db.query(`select ${COLS} from facilities f left join clients c on c.id = f.client_id where f.id = $1`, [id])).rows[0];
    });
  }

  // ---- Areas (wards and units) ----

  @Roles('owner', 'admin')
  @Post(':id/areas')
  addArea(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) facilityId: string, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 120 });
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from facilities where id = $1', [facilityId])).rowCount) throw new NotFoundException('facility not found');
      try {
        return (await db.query(
          `insert into areas(tenant_id, facility_id, name, specialty) values ($1,$2,$3,$4) returning id, name, specialty, active`,
          [t.tenantId, facilityId, name, text(body, 'specialty', { max: 80 })],
        )).rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new BadRequestException('That facility already has an area with that name');
        throw err;
      }
    });
  }

  @Roles('owner', 'admin')
  @Patch(':id/areas/:areaId')
  updateArea(
    @Tenant() t: Membership, @Param('id', ParseUUIDPipe) facilityId: string, @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return withTenant(this.pool, t.tenantId, async db => {
      const row = (await db.query(
        `update areas set name = coalesce($3, name), specialty = case when $4 then $5 else specialty end, active = coalesce($6, active)
         where id = $1 and facility_id = $2 returning id, name, specialty, active`,
        [areaId, facilityId, text(body, 'name', { max: 120 }), Boolean(body && 'specialty' in body), text(body, 'specialty', { max: 80 }), bool(body, 'active')],
      )).rows[0];
      if (!row) throw new NotFoundException('area not found');
      return row;
    });
  }
}
