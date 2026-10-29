import type { PoolClient } from 'pg';
import type { CountryCode } from '../common/countries.js';
import { DEFAULT_AGENCY_TIMING, type AgencyTiming } from '../agencies/requests.js';

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
  /** Agency fill (migration 0045): minutes each agency has a request before the next gets it, by how soon the shift starts. */
  agencyTiming: AgencyTiming;
}

export async function loadSettings(db: PoolClient, tenantId: string): Promise<AgencySettings> {
  const { rows } = await db.query<{ expiring_window_days: number; timezone: string; sms_monthly_cap: number; min_rest_hours: number; published_changes: AgencySettings['publishedChanges']; country: CountryCode;
    agency_step_soon_minutes: number; agency_step_today_minutes: number; agency_step_later_minutes: number }>(
    `select expiring_window_days, timezone, sms_monthly_cap, min_rest_hours, published_changes, country,
            agency_step_soon_minutes, agency_step_today_minutes, agency_step_later_minutes
       from tenant_settings where tenant_id = $1`, [tenantId],
  );
  const r = rows[0];
  return r
    ? { expiringWindowDays: r.expiring_window_days, timezone: r.timezone, smsMonthlyCap: r.sms_monthly_cap, minRestHours: r.min_rest_hours, publishedChanges: r.published_changes, country: r.country,
        agencyTiming: { soonMinutes: r.agency_step_soon_minutes, todayMinutes: r.agency_step_today_minutes, laterMinutes: r.agency_step_later_minutes } }
    : { expiringWindowDays: 30, timezone: 'Australia/Melbourne', smsMonthlyCap: 2000, minRestHours: 10, publishedChanges: 'open', country: 'AU', agencyTiming: { ...DEFAULT_AGENCY_TIMING } };
}
