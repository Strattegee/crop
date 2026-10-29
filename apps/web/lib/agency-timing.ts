/**
 * Agency fill timing (migration 0045): how long each agency has a request before the next one in the business's
 * order gets it too, by how soon the shift starts. Pure helpers for Settings → Agencies and the roster's shift panel.
 */
export type AgencyTiming = { soonMinutes: number; todayMinutes: number; laterMinutes: number };
export type TimingBand = keyof AgencyTiming;

/** "10 minutes", "1 hour", "1 hour 30 minutes", "1 day". */
export function minutesWords(mins: number): string {
  if (mins === 1440) return '1 day';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || '0 minutes';
}

export const TIMING_BANDS: Array<{ key: TimingBand; label: string; choices: number[] }> = [
  { key: 'soonMinutes', label: 'Starts within 2 hours', choices: [5, 10, 15, 20, 30, 45, 60, 90, 120] },
  { key: 'todayMinutes', label: 'Starts later today', choices: [15, 30, 45, 60, 90, 120, 180, 240] },
  { key: 'laterMinutes', label: 'Starts tomorrow or later', choices: [30, 60, 120, 180, 240, 360, 720, 1440] },
];

/** The choices for one band as select options, keeping the current value even when it isn't a usual one. */
export function stepChoices(choices: number[], current: number): Array<{ value: number; label: string }> {
  const all = choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
  return all.map(value => ({ value, label: minutesWords(value) }));
}

/** Choices for one request on the shift panel: every usual gap, with the business's own for this shift marked. */
export function requestStepChoices(defaultMinutes: number): Array<{ value: string; label: string }> {
  const all = [...new Set([5, 10, 15, 30, 60, 120, 240, defaultMinutes])].sort((a, b) => a - b);
  return [
    { value: '', label: `${minutesWords(defaultMinutes)} (your usual)` },
    ...all.filter(v => v !== defaultMinutes).map(v => ({ value: String(v), label: minutesWords(v) })),
  ];
}
