import { Body, Controller, Get, Inject, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { int, isTimeZone, text } from '../common/validate.js';
import { isCountry } from '../common/countries.js';
import { APP_POOL } from '../database/database.module.js';
import { addDays } from './compliance.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from './compliance-data.js';
import { loadSettings } from './settings.js';
import { PUBLISHED_CHANGES, type PublishedChanges } from '../roster/publishing.js';
import { STEP_LIMITS } from '../agencies/requests.js';

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
    const minRest = int(body, 'minRestHours', 0, 24);
    const tz = text(body, 'timezone', { max: 60 });
    if (tz && !isTimeZone(tz)) throw new BadRequestException('Choose a valid time zone');
    const country = text(body, 'country', { max: 2 });
    if (country && !isCountry(country)) throw new BadRequestException('Choose a country: Australia, New Zealand, United States or United Kingdom');
    const published = text(body, 'publishedChanges', { max: 20 });
    if (published && !PUBLISHED_CHANGES.includes(published as PublishedChanges)) throw new BadRequestException('Choose what can change after a roster is published');
    const timing = body?.agencyTiming as Record<string, unknown> | undefined;
    if (timing !== undefined && (typeof timing !== 'object' || timing === null || Array.isArray(timing))) throw new BadRequestException('Agency timing must be three numbers of minutes');
    const soon = timing ? int(timing, 'soonMinutes', 1, STEP_LIMITS.soonMinutes) : null;
    const today = timing ? int(timing, 'todayMinutes', 1, STEP_LIMITS.todayMinutes) : null;
    const later = timing ? int(timing, 'laterMinutes', 1, STEP_LIMITS.laterMinutes) : null;
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = await loadSettings(db, t.tenantId);
      await db.query(
        `insert into tenant_settings(tenant_id, expiring_window_days, timezone, sms_monthly_cap, min_rest_hours, published_changes, country,
           agency_step_soon_minutes, agency_step_today_minutes, agency_step_later_minutes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (tenant_id) do update set expiring_window_days = excluded.expiring_window_days, timezone = excluded.timezone,
           sms_monthly_cap = excluded.sms_monthly_cap, min_rest_hours = excluded.min_rest_hours, published_changes = excluded.published_changes,
           country = excluded.country, agency_step_soon_minutes = excluded.agency_step_soon_minutes,
           agency_step_today_minutes = excluded.agency_step_today_minutes, agency_step_later_minutes = excluded.agency_step_later_minutes`,
        [t.tenantId, windowDays ?? cur.expiringWindowDays, tz ?? cur.timezone, smsCap ?? cur.smsMonthlyCap, minRest ?? cur.minRestHours,
          published ?? cur.publishedChanges, country ?? cur.country,
          soon ?? cur.agencyTiming.soonMinutes, today ?? cur.agencyTiming.todayMinutes, later ?? cur.agencyTiming.laterMinutes],
      );
      return loadSettings(db, t.tenantId);
    });
  }
}
