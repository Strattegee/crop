import { Body, Controller, Get, Inject, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { int, isTimeZone, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { addDays } from './compliance.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from './compliance-data.js';
import { loadSettings } from './settings.js';

@ApiBearerAuth()
@Controller()
export class ComplianceController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Compliance dashboard data (spec CRD-11): workers by status, verification queue, upcoming expiries. */
  @Roles(...OFFICE_ROLES)
  @Get('compliance/summary')
  summary(@Tenant() t: Membership, @Query('days') daysParam?: string) {
    const days = Math.min(Math.max(Number(daysParam) || 30, 1), 365);
    return withTenant(this.pool, t.tenantId, async db => {
      const ctx = await complianceContext(db, t.tenantId);
      const workers = (await db.query<{ id: string; roles: string[] }>(`select id, roles from workers where status = 'active'`)).rows;
      const facts = await credentialFactsByWorker(db);
      const rtw = await rightToWorkByWorker(db);
      const counts = { compliant: 0, expiring: 0, non_compliant: 0 };
      for (const w of workers) counts[ctx.evaluate(w.roles, facts.get(w.id) ?? [], rtw.get(w.id) ?? null).status]++;

      const cols = `c.id, c.worker_id as "workerId", w.first_name || ' ' || w.last_name as "workerName", t.name as "typeName",
        c.number, to_char(c.expiry_date, 'YYYY-MM-DD') as "expiryDate", c.evidence, c.created_at as "createdAt"`;
      const queue = (await db.query(
        `select ${cols} from worker_credentials c join workers w on w.id = c.worker_id join credential_types t on t.id = c.credential_type_id
          where c.verification = 'unverified' and w.status = 'active' order by c.created_at limit 200`,
      )).rows;
      const expiring = (await db.query(
        `select ${cols}, c.verification from worker_credentials c join workers w on w.id = c.worker_id join credential_types t on t.id = c.credential_type_id
          where c.verification <> 'rejected' and w.status = 'active' and c.expiry_date between $1::date and $2::date
          order by c.expiry_date limit 200`, [ctx.today, addDays(ctx.today, days)],
      )).rows;
      return { today: ctx.today, activeWorkers: workers.length, counts, verificationQueue: queue, expiringSoon: expiring, days };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get('settings')
  settings(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, db => loadSettings(db, t.tenantId));
  }

  @Roles('owner', 'admin')
  @Patch('settings')
  updateSettings(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const windowDays = int(body, 'expiringWindowDays', 1, 365);
    const smsCap = int(body, 'smsMonthlyCap', 0, 1000000);
    const tz = text(body, 'timezone', { max: 60 });
    if (tz && !isTimeZone(tz)) throw new BadRequestException('timezone must be an IANA time zone');
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = await loadSettings(db, t.tenantId);
      await db.query(
        `insert into tenant_settings(tenant_id, expiring_window_days, timezone, sms_monthly_cap) values ($1,$2,$3,$4)
         on conflict (tenant_id) do update set expiring_window_days = excluded.expiring_window_days, timezone = excluded.timezone,
           sms_monthly_cap = excluded.sms_monthly_cap`,
        [t.tenantId, windowDays ?? cur.expiringWindowDays, tz ?? cur.timezone, smsCap ?? cur.smsMonthlyCap],
      );
      return loadSettings(db, t.tenantId);
    });
  }
}
