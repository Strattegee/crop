import type { PoolClient } from 'pg';

export interface AgencySettings {
  expiringWindowDays: number;
  timezone: string;
  smsMonthlyCap: number;
  /** Minimum hours between shifts; less is a warning when rostering (0 = off). */
  minRestHours: number;
}

export async function loadSettings(db: PoolClient, tenantId: string): Promise<AgencySettings> {
  const { rows } = await db.query<{ expiring_window_days: number; timezone: string; sms_monthly_cap: number; min_rest_hours: number }>(
    'select expiring_window_days, timezone, sms_monthly_cap, min_rest_hours from tenant_settings where tenant_id = $1', [tenantId],
  );
  return rows[0]
    ? { expiringWindowDays: rows[0].expiring_window_days, timezone: rows[0].timezone, smsMonthlyCap: rows[0].sms_monthly_cap, minRestHours: rows[0].min_rest_hours }
    : { expiringWindowDays: 30, timezone: 'Australia/Melbourne', smsMonthlyCap: 2000, minRestHours: 10 };
}
