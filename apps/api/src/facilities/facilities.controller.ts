import { BadRequestException, Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { APP_POOL } from '../database/database.module.js';
import { TenantId } from '../tenancy/tenant-id.decorator.js';
import { TenantGuard } from '../tenancy/tenant.guard.js';

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
@ApiSecurity('tenant')
@UseGuards(TenantGuard)
@Controller('facilities')
export class FacilitiesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Get()
  async list(@TenantId() tenantId: string) {
    return withTenant(this.pool, tenantId, async db =>
      (await db.query('select id, name, timezone from facilities order by name')).rows,
    );
  }

  @Post()
  async create(@TenantId() tenantId: string, @Body() body: CreateFacilityDto) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const timezone = body?.timezone ?? 'Australia/Melbourne';
    if (!name || name.length > 200) throw new BadRequestException('name is required (max 200 characters)');
    if (!isTimeZone(timezone)) throw new BadRequestException('timezone must be an IANA time zone');
    return withTenant(this.pool, tenantId, async db =>
      (await db.query(
        'insert into facilities(tenant_id, name, timezone) values ($1, $2, $3) returning id, name, timezone',
        [tenantId, name, timezone],
      )).rows[0],
    );
  }
}
