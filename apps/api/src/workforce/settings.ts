import type { PoolClient } from 'pg';
import type { CountryCode } from '../common/countries.js';
import { DEFAULT_AGENCY_TIMING, type AgencyTiming } from '../agencies/requests.js';
import { DEFAULT_DISTANCE_FREE_KM } from '../geo/distance.js';
import type { SwapMode } from '../roster/swaps.js';
import { DEFAULT_MARKER_LETTERS, markerLetters, type MarkerLetters } from '../roster/markers.js';

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
  /** Shift swaps between workers in the app (migration 0073): off, approve (an owner or admin approves) or automatic. */
  shiftSwaps: SwapMode;
  /** Letters on roster cards (migration 0079): the business's own, CROP's default for the rest. */
  markerLetters: MarkerLetters;
  /** Distance in ranking (migration 0090): people further than this (km) from a site rank after the others; 0 = never counts. */
  distanceFreeKm: number;
}

export async function loadSettings(db: PoolClient, tenantId: string): Promise<AgencySettings> {
  const { rows } = await db.query<{ expiring_window_days: number; timezone: string; sms_monthly_cap: number; min_rest_hours: number; published_changes: AgencySettings['publishedChanges']; country: CountryCode;
    agency_step_soon_minutes: number; agency_step_today_minutes: number; agency_step_later_minutes: number; shift_swaps: SwapMode; marker_letters: unknown; distance_free_km: number }>(
    `select expiring_window_days, timezone, sms_monthly_cap, min_rest_hours, published_changes, country,
            agency_step_soon_minutes, agency_step_today_minutes, agency_step_later_minutes, shift_swaps, marker_letters, distance_free_km
       from tenant_settings where tenant_id = $1`, [tenantId],
  );
  const r = rows[0];
  return r
    ? { expiringWindowDays: r.expiring_window_days, timezone: r.timezone, smsMonthlyCap: r.sms_monthly_cap, minRestHours: r.min_rest_hours, publishedChanges: r.published_changes, country: r.country,
        agencyTiming: { soonMinutes: r.agency_step_soon_minutes, todayMinutes: r.agency_step_today_minutes, laterMinutes: r.agency_step_later_minutes }, shiftSwaps: r.shift_swaps, markerLetters: markerLetters(r.marker_letters), distanceFreeKm: r.distance_free_km }
    : { expiringWindowDays: 30, timezone: 'Australia/Melbourne', smsMonthlyCap: 2000, minRestHours: 10, publishedChanges: 'open', country: 'AU', agencyTiming: { ...DEFAULT_AGENCY_TIMING }, shiftSwaps: 'off', markerLetters: { ...DEFAULT_MARKER_LETTERS }, distanceFreeKm: DEFAULT_DISTANCE_FREE_KM };
}
