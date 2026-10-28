import { cache } from 'react';
import { api } from './api';

/** Used only if the business's settings can't be read; every business has its own time zone in Settings. */
const FALLBACK_ZONE = 'Australia/Melbourne';

export type BusinessSettings = { timezone?: string; country?: string; publishedChanges?: 'open' | 'managers' | 'locked'; minRestHours?: number };

/** The signed-in business's settings, fetched once per request. */
export const businessSettings = cache(async (): Promise<BusinessSettings> =>
  api<BusinessSettings>('/settings').catch(() => ({} as BusinessSettings)));

/** The business's time zone (Settings), never the server's. */
export async function businessZone(): Promise<string> {
  return (await businessSettings()).timezone || FALLBACK_ZONE;
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export const todayIn = (zone: string, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now);

/** "28 Oct, 3:15 pm" in a time zone. */
export const whenIn = (zone: string) => (iso: string) =>
  new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: zone }).format(new Date(iso));
