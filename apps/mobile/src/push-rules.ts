/** Pure rules for push notifications in the app (tested without a phone). */

export type PushPlatform = 'ios' | 'android';

/** CROP sends push to iPhones and Android phones only (not the web preview). */
export function pushPlatform(os: string): PushPlatform | null {
  return os === 'ios' || os === 'android' ? os : null;
}

/** Ask the person only when they haven't said yes or no before; iOS lets an app ask once. */
export function shouldAsk(status: 'granted' | 'denied' | 'undetermined', canAskAgain: boolean): boolean {
  return status === 'undetermined' || (status === 'denied' && canAskAgain);
}

/** Phones registered in this session, by business, so sign-out can forget them. */
export class Registered {
  private readonly byTenant = new Map<string, string>();
  set(tenant: string, token: string) { this.byTenant.set(tenant, token); }
  has(tenant: string, token: string) { return this.byTenant.get(tenant) === token; }
  take(): Array<[string, string]> {
    const all = [...this.byTenant.entries()];
    this.byTenant.clear();
    return all;
  }
}

/** The worker app's tabs a tapped notification can open (CROP's `PUSH_SCREENS`). */
export type PushScreen = 'shifts' | 'offers' | 'availability' | 'credentials';
const SCREENS: readonly string[] = ['shifts', 'offers', 'availability', 'credentials'];

/** Where a tapped notification should go: which business and tab, or null to just open the app. */
export type PushTap = { tenant: string; screen: PushScreen | null };

/**
 * Reads the data CROP sent with a notification. Only a business the person still belongs to is opened;
 * anything unexpected is ignored, so a tap never does more than open the app.
 */
export function tapTarget(data: unknown, slugs: readonly string[]): PushTap | null {
  if (!data || typeof data !== 'object') return null;
  const { tenant, screen } = data as { tenant?: unknown; screen?: unknown };
  if (typeof tenant !== 'string' || !slugs.includes(tenant)) return null;
  return { tenant, screen: typeof screen === 'string' && SCREENS.includes(screen) ? (screen as PushScreen) : null };
}
