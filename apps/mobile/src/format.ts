/** Pure helpers for the worker app's screens (tested in test/format.spec.ts). */

export interface MyShift {
  id: string;
  date: string; // YYYY-MM-DD, the site's local date
  start: string; // HH:MM local
  end: string;
  site: string;
  area: string | null;
  role: string;
  timezone: string;
  breakMinutes: number;
  duties: string[];
  label: string;
  state: 'booked' | 'to_confirm';
}

export interface MyOffer {
  id: string;
  expiresAt: string | null;
  offeredAt: string;
  shift: Omit<MyShift, 'state'>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 2 Nov" for a YYYY-MM-DD date; "Today" and "Tomorrow" relative to `today`. */
export function dayLabel(date: string, today?: string): string {
  if (today && date === today) return 'Today';
  if (today && date === addDays(today, 1)) return 'Tomorrow';
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Shifts grouped by local date, in order. */
export function byDay<S extends { date: string }>(shifts: S[]): { date: string; shifts: S[] }[] {
  const out: { date: string; shifts: S[] }[] = [];
  for (const s of shifts) {
    const last = out[out.length - 1];
    if (last && last.date === s.date) last.shifts.push(s);
    else out.push({ date: s.date, shifts: [s] });
  }
  return out;
}

/** "07:00–15:30" plus the break when there is one. */
export function timeRange(s: { start: string; end: string; breakMinutes: number }): string {
  const t = `${s.start}–${s.end}`;
  return s.breakMinutes > 0 ? `${t} (${s.breakMinutes} min break)` : t;
}

/** "Chef · Kitchen" */
export function roleLine(s: { role: string; area: string | null }): string {
  return s.area ? `${s.role} · ${s.area}` : s.role;
}

/** How long an offer stays open, in plain words, or null when it has no closing time. */
export function offerCloses(expiresAt: string | null, now = new Date()): string | null {
  if (!expiresAt) return null;
  const mins = Math.round((Date.parse(expiresAt) - now.getTime()) / 60_000);
  if (mins <= 0) return 'Closed';
  if (mins < 60) return `Closes in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Closes in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `Closes in ${days} day${days === 1 ? '' : 's'}`;
}

export const STATE_LABEL: Record<MyShift['state'], string> = { booked: 'Booked', to_confirm: 'To be confirmed' };

/** The businesses someone can use the app in (any role; the API says if they aren't on that business's staff). */
export function businessesOf(me: { memberships: { tenantSlug: string; tenantName: string; role: string }[] }) {
  return me.memberships.map(m => ({ slug: m.tenantSlug, name: m.tenantName }));
}
