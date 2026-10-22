import { BadRequestException, Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';

class CreateFacilityDto {
  @ApiProperty({ type: String, example: 'Ward 3 North' }) name!: string;
  @ApiProperty({ type: String, example: 'Australia/Melbourne', required: false }) timezone?: string;
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Example tenant-scoped resource; shows the pattern every module follows. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('facilities')
export class FacilitiesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  async list(@Tenant() tenant: Membership) {
    return withTenant(this.pool, tenant.tenantId, async db =>
      (await db.query('select id, name, timezone from facilities order by name')).rows,
    );
  }

  @Roles('owner', 'admin')
  @Post()
  async create(@Tenant() tenant: Membership, @Body() body: CreateFacilityDto) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const timezone = body?.timezone ?? 'Australia/Melbourne';
    if (!name || name.length > 200) throw new BadRequestException('name is required (max 200 characters)');
    if (!isTimeZone(timezone)) throw new BadRequestException('timezone must be an IANA time zone');
    return withTenant(this.pool, tenant.tenantId, async db =>
      (await db.query(
        'insert into facilities(tenant_id, name, timezone) values ($1, $2, $3) returning id, name, timezone',
        [tenant.tenantId, name, timezone],
      )).rows[0],
    );
  }
}
