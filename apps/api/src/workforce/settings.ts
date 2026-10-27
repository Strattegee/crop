import type { PoolClient } from 'pg';
import type { CountryCode } from '../common/countries.js';

export interface AgencySettings {
  expiringWindowDays: number;
  timezone: string;
  smsMonthlyCap: number;
  /** Minimum hours between shifts; less is a warning when rostering (0 = off). */
  minRestHours: number;
  /** What may change once a week's roster is published: open, managers (owners and admins only) or locked. */
  publishedChanges: 'open' | 'managers' | 'locked';
  /** The business's country (migration 0028): its default for new sites. */
  country: CountryCode;
}

export async function loadSettings(db: PoolClient, tenantId: string): Promise<AgencySettings> {
  const { rows } = await db.query<{ expiring_window_days: number; timezone: string; sms_monthly_cap: number; min_rest_hours: number; published_changes: AgencySettings['publishedChanges']; country: CountryCode }>(
    'select expiring_window_days, timezone, sms_monthly_cap, min_rest_hours, published_changes, country from tenant_settings where tenant_id = $1', [tenantId],
  );
  return rows[0]
    ? { expiringWindowDays: rows[0].expiring_window_days, timezone: rows[0].timezone, smsMonthlyCap: rows[0].sms_monthly_cap, minRestHours: rows[0].min_rest_hours, publishedChanges: rows[0].published_changes, country: rows[0].country }
    : { expiringWindowDays: 30, timezone: 'Australia/Melbourne', smsMonthlyCap: 2000, minRestHours: 10, publishedChanges: 'open', country: 'AU' };
}
