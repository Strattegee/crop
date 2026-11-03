import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import type { AuthContext, Membership } from '../auth/auth.types.js';
import { Auth, Tenant } from '../auth/decorators.js';
import { oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { PUSH_PLATFORMS, pushTokenProblem } from './push.js';

/**
 * The CROP app registers its push token here after sign-in (any role), and forgets it at sign-out.
 * One live row per business and token: a phone that changes hands moves to the new sign-in.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('push-devices')
export class PushDevicesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Post()
  @HttpCode(204)
  async register(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const token = text(body, 'token', { required: true, max: 300 })!;
    const platform = oneOf(body, 'platform', PUSH_PLATFORMS, { required: true })!;
    const problem = pushTokenProblem(token);
    if (problem) throw new BadRequestException(problem);
    await withTenant(this.pool, t.tenantId, async db => {
      await db.query(
        `update push_devices set removed_at = now(), removed_reason = 'another_user'
          where token = $1 and user_id <> $2 and removed_at is null`, [token, auth.userId]);
      const seen = await db.query(
        `update push_devices set last_seen_at = now(), platform = $3
          where token = $1 and user_id = $2 and removed_at is null`, [token, auth.userId, platform]);
      if (!seen.rowCount) {
        await db.query(
          `insert into push_devices(tenant_id, user_id, token, platform) values ($1, $2, $3, $4)`,
          [t.tenantId, auth.userId, token, platform]);
      }
    });
  }

  @Post('remove')
  @HttpCode(204)
  async remove(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const token = text(body, 'token', { required: true, max: 300 })!;
    await withTenant(this.pool, t.tenantId, db => db.query(
      `update push_devices set removed_at = now(), removed_reason = 'signed_out'
        where token = $1 and user_id = $2 and removed_at is null`, [token, auth.userId]));
  }
}
