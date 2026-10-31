/**
 * Dashboards (David, 31 Oct): wording for the numbers on each person's dashboard. Pure, tested in
 * test/dashboard.test.ts. The numbers and their definitions come from `GET /dashboard` (apps/api/src/dashboard).
 */
export type Unit = 'percent' | 'count' | 'hours' | 'days';
export type Standing = 'on_target' | 'off_target' | 'no_target' | 'no_data';
export type Focus = 'allocator' | 'compliance' | 'recruitment' | 'overview';

export interface Kpi {
  key: string; label: string; question: string; how: string; unit: Unit; better: 'higher' | 'lower'; href: string;
  value: number | null; detail: string | null; breakdown: { label: string; value: number }[];
  target: number | null; suggested: number; standing: Standing;
}

export interface Dashboard {
  focus: Focus; label: string; assigned: Focus; assignedByOwner: boolean; seesCosts: boolean;
  focuses: { focus: Focus; label: string }[];
  kpis: Kpi[];
  funnel: { stage: string; label: string; reached: number; movedOn: number | null; conversion: number | null }[] | null;
}

const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** A value in its unit: "92.5%", "3", "4.5 hours", "1 day"; a dash when there's nothing to measure yet. */
export function showValue(value: number | null, unit: Unit): string {
  if (value === null) return '–';
  if (unit === 'percent') return `${num(value)}%`;
  if (unit === 'count') return num(value);
  const word = unit === 'hours' ? 'hour' : 'day';
  return `${num(value)} ${word}${value === 1 ? '' : 's'}`;
}

/** The target line under a number. Nothing is marked until the business has set its own target. */
export function targetLine(k: Pick<Kpi, 'target' | 'suggested' | 'unit' | 'better'>): string {
  const sign = k.better === 'higher' ? 'at least' : k.unit === 'count' && k.target === 0 ? '' : 'at most';
  if (k.target === null) return `No target set (suggested: ${sign ? `${sign} ` : ''}${showValue(k.suggested, k.unit)})`;
  return `Target: ${sign ? `${sign} ` : ''}${showValue(k.target, k.unit)}`;
}

/** CSS class for a tile: colour only when off target (strategy doc: colour means something is wrong). */
export function standingClass(s: Standing): string {
  return s === 'off_target' ? 'kpi off' : s === 'on_target' ? 'kpi on' : 'kpi';
}

/** Short words for the standing, for screen readers and the tile's corner. */
export function standingWords(s: Standing): string {
  return { on_target: 'On target', off_target: 'Off target', no_target: '', no_data: '' }[s];
}

/** Width (0–100) of a funnel bar, relative to the stage with most people. */
export function barWidth(n: number, max: number): number {
  return max > 0 ? Math.max(Math.round((n / max) * 100), n > 0 ? 4 : 0) : 0;
}

/** Choices for an office person's dashboard on the Team screen. */
export const FOCUS_CHOICES: { value: Focus; label: string; hint: string }[] = [
  { value: 'allocator', label: 'Allocator', hint: 'Filling shifts: what is open, unconfirmed or blocked' },
  { value: 'compliance', label: 'Compliance', hint: 'Who is ready to work, what is waiting to be checked or running out' },
  { value: 'recruitment', label: 'Recruitment', hint: 'Applicants, onboarding and who is ready to start' },
  { value: 'overview', label: 'Overview', hint: 'A bit of everything, for owners and managers' },
];
