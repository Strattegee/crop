/**
 * Earlier values of a person's own details (David, 3 Nov 2026, answer 5: "nothing overwritten"). Pure.
 *
 * Nothing new is stored: the audit log (migration 0055) already keeps the old and new values of every change to
 * `workers`. Walking it from today backwards gives what each detail was before each change.
 */

export const HISTORY_FIELDS = ['name', 'preferred_name', 'email', 'mobile', 'gender', 'date_of_birth'] as const;
export type HistoryField = typeof HISTORY_FIELDS[number];

/** The `workers` columns behind each detail. */
const COLUMNS: Record<HistoryField, string[]> = {
  name: ['first_name', 'last_name'],
  preferred_name: ['preferred_name'],
  email: ['email'],
  mobile: ['phone'],
  gender: ['gender'],
  date_of_birth: ['date_of_birth'],
};
const TRACKED = Object.values(COLUMNS).flat();

export type CurrentDetails = Record<string, unknown> & {
  first_name: string; last_name: string; preferred_name: string | null; email: string | null; phone: string | null;
  gender: string | null; date_of_birth: string | null;
};

export type WorkerAuditRow = {
  at: Date | string; actorName: string | null; via: string;
  oldValues: Record<string, unknown> | null;
};

export type EarlierValue = {
  /** What it was before this change (null = not recorded). */
  value: string | null;
  /** When it changed. */
  changedAt: string;
  /** Who changed it, as the audit log says it. */
  by: string | null;
  via: string;
};

const text = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  // Dates come back as text from jsonb; keep only the date part if a time crept in.
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s;
};

function valueOf(state: Record<string, unknown>, f: HistoryField): string | null {
  if (f === 'name') return [text(state.first_name), text(state.last_name)].filter(Boolean).join(' ') || null;
  return text(state[COLUMNS[f][0]]);
}

/**
 * `rows` are the person's own `workers` updates, newest first. Returns each detail's earlier values, newest first,
 * leaving out changes that came back to the same value (e.g. a first name and last name swapped and swapped back
 * still show; a change that only touched other columns doesn't).
 */
export function detailHistory(current: CurrentDetails, rows: WorkerAuditRow[]): Record<HistoryField, EarlierValue[]> {
  const out = Object.fromEntries(HISTORY_FIELDS.map(f => [f, [] as EarlierValue[]])) as Record<HistoryField, EarlierValue[]>;
  const state: Record<string, unknown> = Object.fromEntries(TRACKED.map(c => [c, current[c] ?? null]));
  for (const r of rows) {
    const old = r.oldValues ?? {};
    const touched = TRACKED.filter(c => c in old);
    if (!touched.length) continue;
    const before = { ...state };
    for (const c of touched) state[c] = old[c];
    for (const f of HISTORY_FIELDS) {
      if (!COLUMNS[f].some(c => touched.includes(c))) continue;
      const was = valueOf(state, f);
      if (was === valueOf(before, f)) continue;
      out[f].push({ value: was, changedAt: new Date(r.at).toISOString(), by: r.actorName, via: r.via });
    }
  }
  return out;
}
