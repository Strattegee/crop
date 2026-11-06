import { fromHome } from './format';

/**
 * Projects in manager mode (per-site access "still to do", 6 Nov): the projects someone runs, read from the same
 * office endpoints as the web (`GET /projects`, `GET /projects/:id`; supervisors see only their own sites through the
 * database's site rules). Pure wording helpers, tested in `test/projects.spec.ts`.
 */

export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'completed' | 'archived';

export interface ProjectRow {
  id: string; name: string; code: string | null; status: ProjectStatus; statusLabel: string; dates: string | null;
  clientName: string | null; managerName: string | null; teamSize: number; shiftsThisWeek: number; unfilledThisWeek: number;
  unfilledNext7: number; equipmentCount: number;
}

export interface ProjectMember {
  id: string; workerId: string; name: string; teamRole: string; areaName: string | null; state: 'current' | 'upcoming' | 'ended'; line: string;
  distanceKm?: number | null;
}

export interface ProjectEquipment {
  id: string; equipmentName: string; typeName: string; equipmentStatus: string; areaName: string | null; state: 'current' | 'upcoming' | 'ended';
  line: string; checkState: 'ok' | 'due_soon' | 'overdue';
}

export interface ProjectStock { itemId: string; name: string; unit: string; onHand: number; reorderLevel: number | null; low: boolean }

export interface ProjectDay { day: string; rostered: number; filled: number; unfilled: number }

export interface ProjectDetail {
  id: string; name: string; code: string | null; description: string | null; statusLabel: string | null; dates: string | null; clientName: string | null;
  managerName: string | null; supervisorName: string | null; addressLine: string | null; suburb: string | null; state: string | null; postcode: string | null;
  today: string; weekStart: string; days: ProjectDay[]; week: { shifts: number; unfilled: number };
  team: ProjectMember[]; equipment: ProjectEquipment[]; stock: ProjectStock[];
  counts: { team: number; equipment: number; equipmentUnavailable: number; equipmentChecks: number; lowStock: number };
}

type Word = { one: string; many: string; lower: string; lowerMany: string };

/** "3 shifts" / "1 shift". */
function count(n: number, w: Pick<Word, 'lower' | 'lowerMany'>): string {
  return `${n} ${n === 1 ? w.lower : w.lowerMany}`;
}

/** "Northside Builders · Active · 3 Nov – 20 Mar": who it's for, its state and dates. */
export function projectLine(p: Pick<ProjectRow, 'clientName' | 'statusLabel' | 'dates'>): string {
  return [p.clientName, p.statusLabel, p.dates].filter(Boolean).join(' · ');
}

/** "4 on the team · 12 shifts this week · 2 unfilled in the next 7 days", leaving out what's nothing. */
export function projectCounts(p: Pick<ProjectRow, 'teamSize' | 'shiftsThisWeek' | 'unfilledNext7'>, word: Word): string {
  const parts = [
    p.teamSize ? `${p.teamSize} on the team` : null,
    p.shiftsThisWeek ? `${count(p.shiftsThisWeek, word)} this week` : `No ${word.lowerMany} this week`,
    p.unfilledNext7 ? `${p.unfilledNext7} unfilled in the next 7 days` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Projects needing a person soonest first (unfilled in 7 days), then the API's order (active first, by name). */
export function projectOrder(list: ProjectRow[]): ProjectRow[] {
  return list.map((p, i) => ({ p, i })).sort((a, b) => Number(b.p.unfilledNext7 > 0) - Number(a.p.unfilledNext7 > 0) || a.i - b.i).map(x => x.p);
}

/** "Today: 5 shifts · 4 filled · 1 unfilled", or "Today: nothing rostered". */
export function projectDayLine(d: ProjectDay, today: string, word: Word): string {
  const when = d.day === today ? 'Today' : 'Tomorrow';
  if (!d.rostered) return `${when}: nothing rostered`;
  return `${when}: ${[count(d.rostered, word), `${d.filled} filled`, d.unfilled ? `${d.unfilled} unfilled` : null].filter(Boolean).join(' · ')}`;
}

/** The address on one line, or null. */
export function addressLine(p: Pick<ProjectDetail, 'addressLine' | 'suburb' | 'state' | 'postcode'>): string | null {
  const place = [p.suburb, p.state, p.postcode].filter(Boolean).join(' ');
  const line = [p.addressLine, place].filter(Boolean).join(', ');
  return line || null;
}

/** "Supervisor · Formwork · Until 20 Mar · 12 km from home": a team member's line (the role on the team, never their details). */
export function memberLine(m: ProjectMember): string {
  const role = m.teamRole === 'supervisor' ? 'Supervisor' : null;
  return [role, m.areaName, m.line, fromHome(m.distanceKm)].filter(Boolean).join(' · ');
}

/** The team now first, then those starting later; ended entries left out. */
export function teamShown(team: ProjectMember[]): { current: ProjectMember[]; upcoming: ProjectMember[] } {
  return { current: team.filter(m => m.state === 'current'), upcoming: team.filter(m => m.state === 'upcoming') };
}

const CHECK_WORDS: Record<ProjectEquipment['checkState'], string | null> = { ok: null, due_soon: 'A date is due soon', overdue: 'A date is overdue' };
const STATUS_WORDS: Record<string, string> = { out_of_service: 'Out of service', retired: 'Retired' };

/** "Excavator · Bay 2 · Until 20 Mar" plus what's wrong with it, worst first. */
export function equipmentLine(e: ProjectEquipment): { line: string; problem: string | null } {
  return {
    line: [e.typeName, e.areaName, e.line].filter(Boolean).join(' · '),
    problem: STATUS_WORDS[e.equipmentStatus] ?? CHECK_WORDS[e.checkState],
  };
}

/** "12 box on hand (reorder at 20)". */
export function stockLine(s: ProjectStock): string {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  return `${n(s.onHand)} ${s.unit} on hand${s.reorderLevel !== null ? ` (reorder at ${n(s.reorderLevel)})` : ''}`;
}

/** The project's things to look at, in plain words, or [] when all is well. */
export function projectAlerts(p: Pick<ProjectDetail, 'counts' | 'week'>, word: Word, equipment: Word): string[] {
  const out: string[] = [];
  if (p.week.unfilled) out.push(`${p.week.unfilled} ${p.week.unfilled === 1 ? word.lower : word.lowerMany} unfilled this week`);
  if (p.counts.equipmentUnavailable) out.push(`${p.counts.equipmentUnavailable} ${equipment.lower} out of service`);
  if (p.counts.equipmentChecks) out.push(`${p.counts.equipmentChecks} ${equipment.lower} with a date due or overdue`);
  if (p.counts.lowStock) out.push(`${p.counts.lowStock} ${p.counts.lowStock === 1 ? 'item' : 'items'} low on stock`);
  return out;
}
