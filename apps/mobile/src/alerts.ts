/** Pure helpers for the manager side's phone alerts screen (`AlertsScreen.tsx`; API `GET/PUT /alerts`). */

export interface AlertSettings {
  decisions: boolean;
  atRisk: boolean;
  quietFrom: string | null;
  quietUntil: string | null;
  quietLine: string;
  phones: number;
  timezone: string;
  /** Owners and admins: they decide leave and changes, so they can have those alerts. */
  decides: boolean;
}

/** Quiet hours offered as one tap each (CROP's default is 10pm to 6am). */
export const QUIET_CHOICES: ReadonlyArray<{ key: string; label: string; from: string | null; until: string | null }> = [
  { key: 'off', label: 'None', from: null, until: null },
  { key: '21-07', label: '9pm to 7am', from: '21:00', until: '07:00' },
  { key: '22-06', label: '10pm to 6am', from: '22:00', until: '06:00' },
  { key: '22-07', label: '10pm to 7am', from: '22:00', until: '07:00' },
  { key: '23-06', label: '11pm to 6am', from: '23:00', until: '06:00' },
];

/** The chip that matches their quiet hours, or null when they chose other times on the web or the API. */
export function quietChoice(s: Pick<AlertSettings, 'quietFrom' | 'quietUntil'>): string | null {
  return QUIET_CHOICES.find(c => c.from === s.quietFrom && c.until === s.quietUntil)?.key ?? null;
}

/** "3:30pm" from "15:30". */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

/** The line under the quiet hours. */
export function quietNote(s: Pick<AlertSettings, 'quietFrom' | 'quietUntil' | 'timezone'>, shifts = 'shifts'): string {
  if (!s.quietFrom || !s.quietUntil) return 'Alerts come at any time of day.';
  const zone = s.timezone.split('/').pop()!.replace(/_/g, ' ');
  return `From ${clock(s.quietFrom)} to ${clock(s.quietUntil)} (${zone} time) alerts wait until quiet hours end; ${shifts} starting soon are only sent then if they still need someone.`;
}

/** Shown when this sign-in has no phone registered for notifications. */
export function phonesNote(phones: number): string | null {
  return phones > 0 ? null : 'This phone isn\'t receiving CROP notifications yet. Allow notifications for CROP in your phone\'s settings, then open the app again.';
}
