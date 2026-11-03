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
