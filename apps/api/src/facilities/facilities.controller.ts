import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, SITE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { bool, date, isTimeZone, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { COUNTRIES, isCountry, normalPostcode, siteZone, type CountryCode } from '../common/countries.js';
import { loadSettings } from '../workforce/settings.js';
import { todayIn } from '../workforce/compliance.js';
import { kindAndStatus, PROJECT_STATUSES, SITE_KINDS, type ProjectStatus, type SiteKind } from '../projects/projects.js';
const COLS = `f.id, f.name, f.client_id as "clientId", c.name as "clientName", f.address_line as "addressLine", f.suburb, f.state,
  f.postcode, f.country, f.timezone, f.phone, f.parking_notes as "parkingNotes", f.entry_notes as "entryNotes", f.active,
  f.office_id as "officeId", o.name as "officeName", f.kind, f.code, f.description, to_char(f.starts_on, 'YYYY-MM-DD') as "startsOn",
  to_char(f.ends_on, 'YYYY-MM-DD') as "endsOn", f.status, f.manager_user_id as "managerUserId",
  (select t.name from app_office_team() t where t.user_id = f.manager_user_id) as "managerName"`;
const FROM = `facilities f left join clients c on c.id = f.client_id left join offices o on o.id = f.office_id`;

/**
 * A site's country, region (state), postcode and time zone, checked against the country (migration 0028).
 * Australian and US sites pick from the state list; NZ and UK take a region name. The time zone comes from
 * the one given, else the state where that settles it, else the country's default (Broken Hill: give Adelaide).
 */
function place(body: Record<string, unknown>, country: CountryCode) {
  const c = COUNTRIES[country];
  const has = (k: string) => Boolean(body && k in body);
  let region = text(body, 'state', { max: 60 });
  if (region && c.regions) {
    region = region.toUpperCase();
    if (!c.regions.includes(region)) throw new BadRequestException(`Choose a ${c.regionLabel.toLowerCase()} in ${c.name}`);
  }
  let pc = text(body, 'postcode', { max: 10 });
  if (pc) {
    pc = normalPostcode(country, pc);
    if (!c.postcode.test(pc)) throw new BadRequestException(`Postcode for ${c.name}: ${c.postcodeHint}`);
  }
  const tz = text(body, 'timezone', { max: 60 });
  if (tz && !isTimeZone(tz)) throw new BadRequestException('Choose a valid time zone');
  return { region, postcode: pc, givenZone: tz, has };
}

/**
 * The office given (`officeId`): undefined when not sent, null when cleared; must be one of the business's live
 * offices, or the one the site (`siteId`) is already in.
 */
async function officeChoice(db: PoolClient, body: Record<string, unknown>, siteId: string | null = null): Promise<string | null | undefined> {
  if (!body || !('officeId' in body)) return undefined;
  const id = text(body, 'officeId', { max: 40 });
  if (id === null) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await db.query(
    'select 1 from offices where id = $1 and (active or id = (select office_id from facilities where id = $2))', [id, siteId])).rowCount) {
    throw new BadRequestException('Choose an office');
  }
  return id;
}

/**
 * Project fields (migration 0084): kind, code, description, dates, status and manager. Only what was sent is
 * returned (undefined = keep). A site has no status; a project is active unless archived (`kindAndStatus`).
 */
async function projectFields(db: PoolClient, body: Record<string, unknown>, cur: { id: string; kind: SiteKind; status: ProjectStatus | null; active: boolean; starts_on: string | null; ends_on: string | null } | null, zone: string) {
  const has = (k: string) => Boolean(body && k in body);
  const kind = oneOf(body, 'kind', SITE_KINDS);
  const status = oneOf(body, 'status', PROJECT_STATUSES);
  const finalKind = kind ?? cur?.kind ?? 'site';
  if (status && finalKind !== 'project') throw new BadRequestException('Only a project has a status');
  const startsOn = has('startsOn') ? date(body, 'startsOn') : cur?.starts_on ?? null;
  const endsOn = has('endsOn') ? date(body, 'endsOn') : cur?.ends_on ?? null;
  if (startsOn && endsOn && endsOn < startsOn) throw new BadRequestException('The expected completion is before the start date');
  let managerUserId: string | null | undefined;
  if (has('managerUserId')) {
    managerUserId = text(body, 'managerUserId', { max: 40 });
    if (managerUserId !== null && (!/^[0-9a-f-]{36}$/i.test(managerUserId)
      || !(await db.query('select 1 from app_office_team() where user_id = $1', [managerUserId])).rowCount)) {
      throw new BadRequestException('Choose a manager from the office team');
    }
  }
  const code = has('code') ? text(body, 'code', { max: 30 }) : undefined;
  if (code) {
    const taken = await db.query('select 1 from facilities where lower(trim(code)) = lower($1) and id is distinct from $2', [code, cur?.id ?? null]);
    if (taken.rowCount) throw new BadRequestException('Another {site} already has that code');
  }
  const ks = kindAndStatus(cur ? { kind: cur.kind, status: cur.status, active: cur.active } : null,
    { kind, status, active: bool(body, 'active'), startsOn }, todayIn(zone));
  return {
    ...ks, code, startsOn, endsOn, managerUserId,
    description: has('description') ? text(body, 'description', { max: 2000 }) : undefined,
  };
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

  @Roles(...SITE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query('clientId') clientId?: string, @Query('kind') kind?: string) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select ${COLS} from ${FROM}
        where ($1::uuid is null or f.client_id = $1) and ($2::text is null or f.kind = $2) order by f.active desc, f.name`,
      [clientId && /^[0-9a-f-]{36}$/i.test(clientId) ? clientId : null, kind === 'site' || kind === 'project' ? kind : null],
    )).rows);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 200 });
    const clientId = text(body, 'clientId', { max: 40 });
    const given = text(body, 'country', { max: 2 });
    if (given && !isCountry(given)) throw new BadRequestException('Choose a country: Australia, New Zealand, United States or United Kingdom');
    return withTenant(this.pool, t.tenantId, async db => {
      await clientExists(db, clientId);
      const country = (given as CountryCode | null) ?? (await loadSettings(db, t.tenantId)).country;
      const p = place(body, country);
      const timezone = siteZone(country, p.region, p.givenZone);
      const officeId = (await officeChoice(db, body)) ?? null;
      const pj = await projectFields(db, body, null, timezone);
      const row = (await db.query<{ id: string }>(
        `insert into facilities(tenant_id, client_id, name, address_line, suburb, state, postcode, timezone, phone, parking_notes, entry_notes, country, office_id,
                                kind, code, description, starts_on, ends_on, status, manager_user_id, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning id`,
        [t.tenantId, clientId, name, text(body, 'addressLine', { max: 200 }), text(body, 'suburb', { max: 100 }), p.region, p.postcode,
          timezone, text(body, 'phone', { max: 30 }), text(body, 'parkingNotes', { max: 1000 }), text(body, 'entryNotes', { max: 1000 }), country, officeId,
          pj.kind, pj.code ?? null, pj.description ?? null, pj.startsOn, pj.endsOn, pj.status, pj.managerUserId ?? null, pj.active],
      )).rows[0];
      return (await db.query(`select ${COLS} from ${FROM} where f.id = $1`, [row.id])).rows[0];
    });
  }

  @Roles(...SITE_ROLES)
  @Get(':id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const f = (await db.query(`select ${COLS} from ${FROM} where f.id = $1`, [id])).rows[0];
      if (!f) throw new NotFoundException('facility not found');
      const areas = (await db.query(`select id, name, specialty, active from areas where facility_id = $1 order by active desc, name`, [id])).rows;
      return { ...f, areas };
    });
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const has = (k: string) => Boolean(body && k in body);
    const clientId = text(body, 'clientId', { max: 40 });
    const given = text(body, 'country', { max: 2 });
    if (given && !isCountry(given)) throw new BadRequestException('Choose a country: Australia, New Zealand, United States or United Kingdom');
    return withTenant(this.pool, t.tenantId, async db => {
      if (has('clientId')) await clientExists(db, clientId);
      const officeId = await officeChoice(db, body, id);
      const cur = (await db.query<{ id: string; country: CountryCode; state: string | null; postcode: string | null; timezone: string; kind: SiteKind; status: ProjectStatus | null; active: boolean; starts_on: string | null; ends_on: string | null }>(
        `select id, country, state, postcode, timezone, kind, status, active, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
           from facilities where id = $1`, [id])).rows[0];
      if (!cur) throw new NotFoundException('facility not found');
      const pj = await projectFields(db, body, cur, cur.timezone);
      const country = (given as CountryCode | null) ?? cur.country;
      const p = place(body, country);
      const state = has('state') ? p.region : (given && given !== cur.country ? null : cur.state);
      const pc = has('postcode') ? p.postcode : (given && given !== cur.country ? null : cur.postcode);
      // A new country or state moves the site's time zone too, unless one is given.
      const tz = p.givenZone ?? (given || has('state') ? siteZone(country, state, null) : null);
      const r = await db.query(
        `update facilities set
           name = coalesce($2, name), client_id = case when $3 then $4::uuid else client_id end,
           address_line = case when $5 then $6 else address_line end, suburb = case when $7 then $8 else suburb end,
           state = case when $9 then $10 else state end, postcode = case when $11 then $12 else postcode end, country = $21,
           timezone = coalesce($13, timezone), phone = case when $14 then $15 else phone end,
           parking_notes = case when $16 then $17 else parking_notes end, entry_notes = case when $18 then $19 else entry_notes end,
           active = $20, office_id = case when $22 then $23::uuid else office_id end,
           kind = $24, status = $25, starts_on = $26, ends_on = $27, code = case when $28 then $29 else code end,
           description = case when $30 then $31 else description end, manager_user_id = case when $32 then $33::uuid else manager_user_id end
         where id = $1`,
        [id, text(body, 'name', { max: 200 }), has('clientId'), clientId, has('addressLine'), text(body, 'addressLine', { max: 200 }),
          has('suburb'), text(body, 'suburb', { max: 100 }), true, state, true, pc, tz,
          has('phone'), text(body, 'phone', { max: 30 }), has('parkingNotes'), text(body, 'parkingNotes', { max: 1000 }),
          has('entryNotes'), text(body, 'entryNotes', { max: 1000 }), pj.active, country, officeId !== undefined, officeId ?? null,
          pj.kind, pj.status, pj.startsOn, pj.endsOn, pj.code !== undefined, pj.code ?? null, pj.description !== undefined, pj.description ?? null,
          pj.managerUserId !== undefined, pj.managerUserId ?? null],
      );
      if (!r.rowCount) throw new NotFoundException('facility not found');
      return (await db.query(`select ${COLS} from ${FROM} where f.id = $1`, [id])).rows[0];
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
        if ((err as { code?: string }).code === '23505') throw new BadRequestException('That {site} already has {an area} with that name');
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
      if (!row) throw new NotFoundException('{Area} not found');
      return row;
    });
  }
}
