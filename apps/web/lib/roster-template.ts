/**
 * The Template tab (David, 3 Nov, answer 2): a site's template shown and edited as a week. Pure helpers, tested in
 * test/roster-template.test.ts; the page is app/(office)/roster/template.
 */
export type TemplateShift = {
  id: string; weekday: number; startTime: string; endTime: string; breakMinutes: number; role: string;
  areaId: string | null; areaName: string | null; shiftCodeId: string | null; shiftCode: string | null; shiftLetter: string | null;
  equipmentOnly: boolean; notes: string | null; genderRequested: 'F' | 'M' | null;
  workerId: string | null; workerName: string | null; workerStatus?: string | null;
  equipmentList: { id: string; name: string; vehicle?: boolean }[]; duties: { id: string; name: string }[];
};

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** A, P or N from a local start time, the same periods as the roster (AM 05:00–11:59, PM 12:00–18:59, night otherwise). */
export function periodLetter(start: string): 'A' | 'P' | 'N' {
  const h = Number(start.slice(0, 2));
  return h >= 5 && h < 12 ? 'A' : h >= 12 && h < 19 ? 'P' : 'N';
}

export type GridRow = { key: string; areaId: string | null; label: string; days: TemplateShift[][] };

/**
 * The week grid: one row per area (by name, "No area" last), seven day cells, each day's shifts by start time then
 * role. Areas named in `areas` with no shifts still get a row, so a shift can be added there.
 */
export function templateGrid(shifts: TemplateShift[], areas: { id: string; name: string }[], noAreaLabel = 'No area'): GridRow[] {
  const rows = new Map<string, GridRow>();
  const row = (areaId: string | null, label: string) => {
    const key = areaId ?? '';
    if (!rows.has(key)) rows.set(key, { key, areaId, label, days: Array.from({ length: 7 }, () => []) });
    return rows.get(key)!;
  };
  for (const a of areas) row(a.id, a.name);
  for (const s of shifts) row(s.areaId, s.areaName ?? noAreaLabel).days[s.weekday - 1].push(s);
  for (const r of rows.values()) for (const d of r.days) d.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.role.localeCompare(b.role));
  if (!rows.has('')) row(null, noAreaLabel);
  return [...rows.values()].sort((a, b) => (a.areaId === null ? 1 : 0) - (b.areaId === null ? 1 : 0) || a.label.localeCompare(b.label));
}

/** Per weekday: how many shifts and paid hours, for the grid's header. */
export function dayTotals(shifts: TemplateShift[]): { shifts: number; hours: number }[] {
  const out = Array.from({ length: 7 }, () => ({ shifts: 0, hours: 0 }));
  for (const s of shifts) {
    const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    let len = m(s.endTime) - m(s.startTime);
    if (len <= 0) len += 24 * 60;
    out[s.weekday - 1].shifts++;
    out[s.weekday - 1].hours = Math.round((out[s.weekday - 1].hours + (len - s.breakMinutes) / 60) * 100) / 100;
  }
  return out;
}

type Form = { get(k: string): FormDataEntryValue | null; getAll(k: string): FormDataEntryValue[] };
const val = (f: Form, k: string) => { const v = f.get(k); return typeof v === 'string' && v.trim() ? v.trim() : null; };

/**
 * The API body for adding (`weekdays`) or changing (`weekday`) a template shift from the panel's form. Blank times
 * with a shift type use the type's times; a blank usual person, area or shift type sends null.
 */
export function templateShiftBody(f: Form, adding: boolean): Record<string, unknown> {
  const equipmentOnly = f.get('equipmentOnly') === 'on';
  const brk = val(f, 'breakMinutes');
  const body: Record<string, unknown> = {
    startTime: val(f, 'startTime'), endTime: val(f, 'endTime'), breakMinutes: brk === null ? null : Number(brk),
    role: equipmentOnly ? null : val(f, 'role'), areaId: val(f, 'areaId'), shiftCodeId: val(f, 'shiftCodeId'), equipmentOnly,
    workerId: equipmentOnly ? null : val(f, 'workerId'), genderRequested: equipmentOnly ? null : val(f, 'genderRequested'),
    notes: val(f, 'notes'),
    dutyIds: f.getAll('dutyIds').filter((x): x is string => typeof x === 'string' && !!x),
    equipmentIds: f.getAll('equipmentIds').filter((x): x is string => typeof x === 'string' && !!x),
  };
  if (adding) body.weekdays = f.getAll('weekdays').map(x => Number(x)).filter(n => Number.isInteger(n) && n >= 1 && n <= 7);
  else body.weekday = Number(val(f, 'weekday'));
  return body;
}

/** "3 shifts added to Mon, Tue and Wed." */
export function addedMessage(weekdays: number[], count: (n: number) => string): string {
  const names = [...weekdays].sort().map(d => WEEKDAYS[d - 1]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  return `${count(weekdays.length)} added to ${list}.`;
}

/** The template's address on the Template tab, keeping the site and template; `extra` sets or clears the rest. */
export function templateHref(site: string | null, template: string | null, extra: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  if (site) q.set('site', site);
  if (template) q.set('template', template);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return `/roster/template${s ? `?${s}` : ''}`;
}
