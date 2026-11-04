/** Small date helpers for the demo-day seed (local dates and times in a site's time zone, without a library). */

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(zone: string) {
  let f = fmts.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    fmts.set(zone, f);
  }
  return f;
}

function parts(zone: string, at: Date) {
  const p = Object.fromEntries(fmt(zone).formatToParts(at).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Minutes the zone is ahead of UTC at that moment. */
function offsetMinutes(zone: string, at: Date): number {
  const p = parts(zone, at);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - at.getTime()) / 60_000);
}

/** The moment a local date and HH:MM happen in a zone. */
export function localToUtc(date: string, time: string, zone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMinutes(zone, new Date(guess));
  let t = guess - first * 60_000;
  const second = offsetMinutes(zone, new Date(t));
  if (second !== first) t = guess - second * 60_000;
  return new Date(t);
}

/** YYYY-MM-DD of a moment in a zone. */
export function localDateOf(at: Date, zone: string): string {
  const p = parts(zone, at);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** HH:MM of a moment in a zone. */
export function localTimeOf(at: Date, zone: string): string {
  const p = parts(zone, at);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: string): number {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

export const mondayOf = (date: string) => addDays(date, 1 - weekdayOf(date));

/** Whole days from a to b. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The availability period of a local start time (as the roster works it out): AM 05:00–11:59, PM 12:00–18:59, else night. */
export function periodOf(start: string): 'am' | 'pm' | 'night' {
  const h = Number(start.slice(0, 2));
  return h >= 5 && h < 12 ? 'am' : h >= 12 && h < 19 ? 'pm' : 'night';
}

/** A repeatable random number generator (mulberry32), seeded from text. */
export function seededRandom(seed: string): () => number {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (Math.imul(a ^ seed.charCodeAt(i), 2654435761) + i) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
