import { BadRequestException, Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { SITE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { loadSettings } from '../workforce/settings.js';
import { alertSettingsOf } from './manager-alerts-data.js';
import { quietLine, quietProblem } from './manager-alerts.js';

function time(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in (body ?? {}))) return undefined;
  const v = body[key];
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw new BadRequestException('Write quiet hours as times like 22:00 and 06:00');
  return v.trim();
}

/**
 * Each office person's own phone alerts (backlog item 9a): what they want on their phone and their quiet hours, in
 * the business's time zone. Only their own; owners don't set them for others.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('alerts')
export class AlertsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private async view(db: PoolClient, t: Membership, userId: string) {
    const s = await alertSettingsOf(db, userId);
    const phones = (await db.query<{ n: number }>('select count(*)::int as n from push_devices where user_id = $1 and removed_at is null', [userId])).rows[0].n;
    return {
      ...s, quietLine: quietLine(s), phones, timezone: (await loadSettings(db, t.tenantId)).timezone,
      decides: t.role === 'owner' || t.role === 'admin',
    };
  }

  @Roles(...SITE_ROLES)
  @Get()
  get(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, db => this.view(db, t, auth.userId));
  }

  @Roles(...SITE_ROLES)
  @Put()
  set(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const decisions = bool(body, 'decisions');
    const atRisk = bool(body, 'atRisk');
    const from = time(body, 'quietFrom');
    const until = time(body, 'quietUntil');
    return withTenant(this.pool, t.tenantId, async db => {
      const was = await alertSettingsOf(db, auth.userId);
      const next = {
        decisions: decisions ?? was.decisions, atRisk: atRisk ?? was.atRisk,
        quietFrom: from === undefined ? was.quietFrom : from, quietUntil: until === undefined ? was.quietUntil : until,
      };
      const problem = quietProblem(next.quietFrom, next.quietUntil);
      if (problem) throw new BadRequestException(problem);
      await db.query(
        `insert into member_alerts(tenant_id, user_id, decisions, at_risk, quiet_from, quiet_until) values ($1, $2, $3, $4, $5, $6)
         on conflict (tenant_id, user_id) do update set decisions = excluded.decisions, at_risk = excluded.at_risk,
           quiet_from = excluded.quiet_from, quiet_until = excluded.quiet_until, updated_at = now()`,
        [t.tenantId, auth.userId, next.decisions, next.atRisk, next.quietFrom, next.quietUntil]);
      return this.view(db, t, auth.userId);
    });
  }
}
