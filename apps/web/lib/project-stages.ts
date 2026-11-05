/**
 * Project stages (David, 5 Nov; migration 0093): pure helpers for the project page's Stages tab. Keep the wording of
 * working days in step with the API's `apps/api/src/projects/stages.ts` (`weekdaysLine`).
 */

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

export type StageRole = { role: string; count: number };
export type StagePerson = { id: string; workerId: string; name: string; role: string; active: boolean; status: string; roleMissing: boolean; supervisor: boolean };
export type Stage = {
  id: string; name: string; areaId: string | null; areaName: string | null; startsOn: string; endsOn: string; weekdays: number[];
  startTime: string; endTime: string; breakMinutes: number; ownTimes: boolean; shiftCodeId: string | null; shiftCode: string | null;
  teamId: string | null; teamName: string | null; notes: string | null; line: string; weekdaysLine: string; workingDays: number;
  state: 'current' | 'upcoming' | 'ended'; roles: StageRole[]; makeUpLine: string | null; needed: number; people: StagePerson[];
  shortLine: string | null; placesPerDay: number; overlaps: string[];
  rostered: { shifts: number; open: number; days: number; outside: number; outsideMovable: number; offHours: number; offHoursMovable: number };
  equipment: { id: string; equipmentId: string; equipmentName: string; typeName: string; line: string }[];
};
export type StagesView = {
  project: { id: string; name: string; startsOn: string | null; endsOn: string | null; timezone: string };
  today: string; span: { from: string; to: string } | null;
  supervisor: { workerId: string; name: string; active: boolean; role: string; workingDays: number; daysRostered: number } | null;
  stages: Stage[];
};
export type RosterResult = {
  created: number; assigned: number; alreadyRostered: number; pastDays: number; supervisorCreated: number; supervisorAssigned: number;
  leftOpen: { date: string; startTime: string; role: string; workerName: string | null; reason: string }[]; summary: string;
};

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mon 9 Nov" for a YYYY-MM-DD date. */
export function dayLabel(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  return `${DAY_SHORT[(x.getUTCDay() + 6) % 7]} ${x.getUTCDate()} ${MONTH[x.getUTCMonth()]}`;
}

/** The ticked working days from the stage form (`wd_1` … `wd_7`); Monday to Friday when none came. */
export function weekdaysFromForm(get: (key: string) => string | undefined): number[] {
  const days = [1, 2, 3, 4, 5, 6, 7].filter(d => get(`wd_${d}`));
  return days.length ? days : DEFAULT_WEEKDAYS;
}

/** "07:00–15:30 · 30 min break", or the shift type's code. */
export function hoursLine(s: Pick<Stage, 'startTime' | 'endTime' | 'breakMinutes' | 'shiftCode' | 'ownTimes'>): string {
  const t = `${s.startTime}–${s.endTime}${s.endTime < s.startTime ? ' (overnight)' : ''}`;
  const brk = s.breakMinutes ? ` · ${s.breakMinutes} min break` : '';
  return !s.ownTimes && s.shiftCode ? `${s.shiftCode} (${t})${brk}` : `${t}${brk}`;
}

/** The timeline's span: the project's dates and every stage's, whichever is wider. */
export function timelineSpan(v: Pick<StagesView, 'project' | 'span'>): { from: string; to: string; days: number } | null {
  const froms = [v.project.startsOn, v.span?.from].filter((x): x is string => !!x);
  const tos = [v.project.endsOn, v.span?.to].filter((x): x is string => !!x);
  if (!v.span || !froms.length || !tos.length) return null;
  const from = froms.sort()[0];
  const to = tos.sort().reverse()[0];
  if (to < from) return null;
  return { from, to, days: daysBetween(from, to) + 1 };
}

export type Bar = { id: string; name: string; lane: number; left: number; width: number; overlaps: boolean };

/**
 * Bars for the stages across the span (percent of its width), each on the first lane free on its dates, so stages
 * that overlap sit on different lanes and the overlap is visible.
 */
export function timelineBars(stages: Pick<Stage, 'id' | 'name' | 'startsOn' | 'endsOn' | 'overlaps'>[], span: { from: string; days: number }): { bars: Bar[]; lanes: number } {
  const laneEnds: string[] = [];
  const bars = [...stages].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn)).map(s => {
    let lane = laneEnds.findIndex(end => end < s.startsOn);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(s.endsOn); } else laneEnds[lane] = s.endsOn;
    const start = Math.max(0, daysBetween(span.from, s.startsOn));
    const len = Math.max(1, daysBetween(s.startsOn, s.endsOn) + 1);
    const pct = (n: number) => Math.round((n / span.days) * 10000) / 100;
    return { id: s.id, name: s.name, lane, left: pct(start), width: Math.min(pct(len), 100 - pct(start)), overlaps: s.overlaps.length > 0 };
  });
  return { bars, lanes: Math.max(1, laneEnds.length) };
}

/** Week marks for the timeline: each Monday in the span (the first day too when it isn't one), at most `max`. */
export function timelineTicks(span: { from: string; to: string; days: number }, max = 26): { date: string; left: number; label: string }[] {
  const out: { date: string; left: number; label: string }[] = [];
  for (let d = span.from; d <= span.to; d = addDays(d, 1)) {
    if (d !== span.from && new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) continue;
    out.push({ date: d, left: Math.round((daysBetween(span.from, d) / span.days) * 10000) / 100, label: dayLabel(d).slice(4) });
  }
  if (out.length <= max) return out;
  const step = Math.ceil(out.length / max);
  return out.filter((_, i) => i % step === 0);
}

/** Where today falls on the timeline (percent), or null outside it. */
export function todayAt(span: { from: string; to: string; days: number }, today: string): number | null {
  if (today < span.from || today > span.to) return null;
  return Math.round(((daysBetween(span.from, today) + 0.5) / span.days) * 10000) / 100;
}

/** The message after "Roster": the API's summary, then the places left open (first few) with their reasons. */
export function rosterMessage(r: RosterResult, shown = 6): string {
  if (!r.leftOpen.length) return r.summary;
  const lines = r.leftOpen.slice(0, shown).map(x => `${dayLabel(x.date)} ${x.startTime} ${x.role}${x.workerName ? ` (${x.workerName})` : ''}: ${x.reason}`);
  const more = r.leftOpen.length > shown ? ` … and ${r.leftOpen.length - shown} more.` : '';
  return `${r.summary} Left open: ${lines.join('; ')}${more}`;
}

/** What moving a stage's shifts did (`POST /project-stages/:id/move-shifts`, or `shifts` from a change or taking it off). */
export type HoursProblem = { date: string; startTime: string; role: string; workerName: string | null; reason: string };
export type MoveResult = {
  cancelled: number; kept: { started: number; agency: number; published: number }; roster: Omit<RosterResult, 'summary'> | null;
  /** Shifts given the stage's new hours, and the people taken off because they couldn't work them (left open). */
  retimed?: number; takenOff?: HoursProblem[]; equipmentKept?: HoursProblem[];
};

/** The message after moving a stage's shifts: the API's summary, then any places left open (as after "Roster"). */
export function moveMessage(r: MoveResult | null, summary: string | null, shown = 6): string | null {
  if (!r || !summary) return null;
  const said = r.roster ? rosterMessage({ ...r.roster, summary }, shown) : summary;
  const off = r.takenOff ?? [];
  if (!off.length) return said;
  const lines = off.slice(0, shown).map(x => `${dayLabel(x.date)} ${x.startTime} ${x.role}${x.workerName ? ` (${x.workerName})` : ''}: ${x.reason}`);
  const more = off.length > shown ? ` … and ${off.length - shown} more.` : '';
  return `${said} Taken off for the new hours: ${lines.join('; ')}${more}`;
}

/**
 * The note under a stage whose shifts (on its days) aren't at its hours or shift type now: how many the button would
 * change, and why the rest stay (published weeks or an agency's person: changed on the roster). Null when all match.
 */
export function hoursNote(r: Pick<Stage['rostered'], 'offHours' | 'offHoursMovable'>): { movable: number; stay: number; stayLine: string | null } | null {
  if (!r.offHours || r.offHours <= 0) return null;
  const stay = Math.max(0, r.offHours - r.offHoursMovable);
  return {
    movable: r.offHoursMovable, stay,
    stayLine: stay ? `${stay} ${stay === 1 ? 'is' : 'are'} in a published week or with an agency's person: change ${stay === 1 ? 'it' : 'them'} on the roster.` : null,
  };
}

/**
 * The note under a stage whose shifts are off its dates: how many the button would move, and why the rest stay
 * (published weeks, started, an agency's person: changed on the roster). Null when every shift is on its dates.
 */
export function outsideNote(r: Pick<Stage['rostered'], 'outside' | 'outsideMovable'>): { movable: number; stay: number; stayLine: string | null } | null {
  if (r.outside <= 0) return null;
  const stay = Math.max(0, r.outside - r.outsideMovable);
  return {
    movable: r.outsideMovable, stay,
    stayLine: stay ? `${stay} ${stay === 1 ? 'is' : 'are'} in a published week, started or with an agency's person: change ${stay === 1 ? 'it' : 'them'} on the roster.` : null,
  };
}

/** "3 of 4 named" for a stage, or "No one named yet". */
export function namedWords(s: Pick<Stage, 'needed' | 'people'>): string {
  const named = s.people.filter(p => p.active).length;
  if (!named) return 'No one named yet';
  return s.needed ? `${named} of ${s.needed} named` : `${named} named`;
}

/** "12 shifts made over 4 days · 4 open" (the noun is the business's word, plural), or null before rostering. */
export function rosteredLine(r: Stage['rostered'], shifts: string): string | null {
  if (!r.shifts) return null;
  return `${r.shifts} ${shifts} made over ${r.days === 1 ? '1 day' : `${r.days} days`}${r.open ? ` · ${r.open} open` : ''}`;
}

/** People to name for a stage: active, not on it already, grouped by role (make-up roles first, short ones marked). */
export function stagePicker(s: Pick<Stage, 'roles' | 'people'>, people: { id: string; name: string; roles: string[] }[]) {
  const on = new Set(s.people.map(p => p.workerId));
  const free = people.filter(p => !on.has(p.id));
  const others = [...new Set(free.flatMap(p => p.roles))].filter(r => !s.roles.some(m => m.role === r)).sort((a, b) => a.localeCompare(b));
  return [...s.roles.map(r => r.role), ...others].map(role => {
    const m = s.roles.find(x => x.role === role);
    const short = m ? m.count - s.people.filter(p => p.active && p.role === role).length : 0;
    return {
      role, label: m ? (short > 0 ? `${role} (short ${short})` : role) : `${role} (not in the make-up)`,
      options: free.filter(p => p.roles.includes(role)).sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ value: `${p.id}|${role}`, label: p.name })),
    };
  }).filter(g => g.options.length > 0);
}
