/**
 * The employee card (David, 31 Oct): pure wording and layout helpers, tested in test/person-card.test.ts.
 * The card is the same compact summary wherever a person appears.
 */

export type CardData = {
  nextExpiry: { name: string; date: string } | null;
  held: string[];
  toCheck: number;
  employmentType: string | null;
  contractedHours: number | null;
  weekHours: number;
  nextShift: { startsAt: string; label: string } | null;
};

export type CardPerson = {
  id: string; firstName: string; lastName: string; preferredName: string | null; status: string; roles: string[];
  compliance: string; gender?: 'F' | 'M' | null; email?: string | null; phone?: string | null; card?: CardData;
};

/** "Ana Example", using the preferred name when there is one. */
export const displayName = (p: Pick<CardPerson, 'firstName' | 'lastName' | 'preferredName'>) => `${p.preferredName || p.firstName} ${p.lastName}`;

/** Two letters for the avatar. */
export const initials = (p: Pick<CardPerson, 'firstName' | 'lastName' | 'preferredName'>) =>
  `${(p.preferredName || p.firstName).trim()[0] ?? ''}${p.lastName.trim()[0] ?? ''}`.toUpperCase();

/** A steady colour per person, from their id, so the same person always looks the same. */
const AVATAR_COLOURS = ['#1d4e79', '#00695c', '#6a1b9a', '#ad1457', '#e65100', '#2e7d32', '#37474f', '#4527a0', '#00838f', '#5d4037'];
export function avatarColour(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

/** The employment letter used on the roster strip: F full-time, P part-time, C casual, B bank. */
export const EMPLOYMENT_LETTER: Record<string, string> = { full_time: 'F', part_time: 'P', casual: 'C', bank: 'B' };

const num = (h: number) => (Number.isInteger(h) ? `${h}` : `${Math.round(h * 100) / 100}`);

/** "18 / 24 h this week", or "18 h this week" when there are no set hours. */
export function hoursLine(c: Pick<CardData, 'weekHours' | 'contractedHours'>): string {
  return c.contractedHours !== null ? `${num(c.weekHours)} / ${num(c.contractedHours)} h this week` : `${num(c.weekHours)} h this week`;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "First aid expires today" / "… in 12 days" / "… on 1 Dec 2026", and how urgent it is (within 30 days = soon). */
export function expiryLine(e: { name: string; date: string } | null, today: string): { text: string; soon: boolean } | null {
  if (!e) return null;
  const n = daysBetween(today, e.date);
  if (n <= 0) return { text: `${e.name} expires today`, soon: true };
  if (n === 1) return { text: `${e.name} expires tomorrow`, soon: true };
  if (n <= 60) return { text: `${e.name} expires in ${n} days`, soon: n <= 30 };
  const d = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${e.date}T00:00:00Z`));
  return { text: `${e.name} expires ${d}`, soon: false };
}

/** The badges that fit, and how many more there are. */
export function badgeList(held: string[], max: number): { shown: string[]; more: number } {
  return { shown: held.slice(0, max), more: Math.max(0, held.length - max) };
}

/** The compliance light: green / amber / red. */
export const LIGHT: Record<string, { cls: 'ok' | 'warn' | 'bad'; label: string }> = {
  compliant: { cls: 'ok', label: 'Ready to work' },
  expiring: { cls: 'warn', label: 'Something expiring' },
  non_compliant: { cls: 'bad', label: 'Not ready to work' },
};

/** Status words shown on the card when the person isn't simply active. */
export const STATUS_WORD: Record<string, string> = {
  onboarding: 'Onboarding', inactive: 'Inactive', offboarded: 'Offboarded', agency: 'Agency',
};
