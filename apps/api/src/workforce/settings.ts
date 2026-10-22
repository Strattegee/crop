import type { PoolClient } from 'pg';

export interface AgencySettings {
  expiringWindowDays: number;
  timezone: string;
}

export async function loadSettings(db: PoolClient, tenantId: string): Promise<AgencySettings> {
  const { rows } = await db.query<{ expiring_window_days: number; timezone: string }>(
    'select expiring_window_days, timezone from tenant_settings where tenant_id = $1', [tenantId],
  );
  return rows[0]
    ? { expiringWindowDays: rows[0].expiring_window_days, timezone: rows[0].timezone }
    : { expiringWindowDays: 30, timezone: 'Australia/Melbourne' };
}
