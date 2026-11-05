import { apiBaseUrl } from './config';
import { STATES, US_STATES } from './places';

/**
 * Applying online (David approved 5 Nov 2026; backlog item 11): the public form at /apply/<slug>, its confirmation
 * page, and Settings › Application form. The API checks everything; the pure helpers here turn the form's fields into
 * the answers the API reads (tested in test/apply.test.ts).
 */

export type QuestionKey = 'name' | 'email' | 'mobile' | 'home' | 'roles' | 'work_type' | 'availability' | 'right_to_work' | 'licence_car'
  | 'credentials' | 'about' | 'cv' | 'heard' | 'consent';
export type CustomType = 'short_text' | 'long_text' | 'yes_no' | 'choice' | 'multi_choice' | 'file';
export type CustomQuestion = { id: string; label: string; help: string | null; type: CustomType; required: boolean; choices: string[] };
export type Choice = { value: string; label: string };

export type ApplyView = {
  business: string; slug: string; intro: string | null; open: boolean; country: 'AU' | 'NZ' | 'US' | 'GB';
  questions: { key: QuestionKey; required: boolean }[];
  custom: CustomQuestion[];
  roles: { name: string; industries: string[] }[];
  credentials: { id: string; name: string; industries: string[] }[];
  packs: { id: string; name: string; appliedAt: string | null }[];
  choices: { workTypes: Choice[]; rightToWork: Choice[]; heard: Choice[]; home: { suburb: string; region: string; postcode: string } };
  word: { role: string; roles: string; credentials: string };
  consentVersion: string; maxFiles: number;
  turnstileSiteKey: string | null; formToken: string | null;
};

export type ConfirmView = { business: string; firstName: string; state: 'ok' | 'expired' | 'confirmed' };
type Result<T> = { ok: true; view: T } | { ok: false; status: number; message: string };

const UNREACHABLE = "CROP can't be reached right now. Please try again in a minute.";

async function call<T>(path: string, init: { method?: string; body?: FormData; headers?: Record<string, string> } = {}): Promise<Result<T>> {
  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, { method: init.method ?? 'GET', body: init.body, headers: init.headers, cache: 'no-store' });
    if (res.status === 413) return { ok: false, status: 413, message: 'The files are too large. Each can be up to 10 MB.' };
    const json = (await res.json().catch(() => ({}))) as T & { message?: string | string[] };
    if (res.ok) return { ok: true, view: json };
    const message = Array.isArray(json.message) ? json.message.join('; ') : json.message;
    return { ok: false, status: res.status, message: message ?? 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, status: 503, message: UNREACHABLE };
  }
}

/** The public form (no cookies or tokens are sent). */
export const applyPage = (slug: string) => call<ApplyView>(`/apply/${encodeURIComponent(slug)}`);
/** Sends an application; `ip` is the applicant's address as the web server saw it (the API keeps only a keyed hash). */
export const sendApplication = (slug: string, form: FormData, ip: string | null) =>
  call<{ received: boolean }>(`/apply/${encodeURIComponent(slug)}`, { method: 'POST', body: form, headers: ip ? { 'x-forwarded-for': ip } : undefined });
export const confirmView = (token: string) => call<ConfirmView>(`/apply-confirm/${encodeURIComponent(token)}`);
export const confirmApplication = (token: string) => call<ConfirmView>(`/apply-confirm/${encodeURIComponent(token)}`, { method: 'POST' });

/** The form's public address: "<app>/apply/<slug>". */
export const applyUrl = (appUrl: string, slug: string) => `${appUrl.replace(/\/$/, '')}/apply/${slug}`;

export const WEEKDAYS = [
  { n: 1, label: 'Monday' }, { n: 2, label: 'Tuesday' }, { n: 3, label: 'Wednesday' }, { n: 4, label: 'Thursday' },
  { n: 5, label: 'Friday' }, { n: 6, label: 'Saturday' }, { n: 7, label: 'Sunday' },
];
export const PERIODS = [{ value: 'am', label: 'Morning' }, { value: 'pm', label: 'Afternoon' }, { value: 'night', label: 'Night' }];

type Getter = { get(k: string): FormDataEntryValue | null; getAll(k: string): FormDataEntryValue[] };
const s = (f: Getter, k: string) => { const v = f.get(k); return typeof v === 'string' ? v : undefined; };
const all = (f: Getter, k: string) => f.getAll(k).filter((v): v is string => typeof v === 'string' && v !== '');

/**
 * The answers the API reads, from the form's fields: plain fields by name, ticks as lists (`roles`, `workTypes`,
 * `credentials`, `avail_<1–7>`), the business's questions as `c_<id>`. Files are sent separately.
 */
export function answersFromForm(f: Getter, custom: CustomQuestion[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const k of ['firstName', 'lastName', 'email', 'mobile', 'suburb', 'region', 'postcode', 'rightToWork', 'rightToWorkStatus',
    'driversLicence', 'ownCar', 'about', 'heardFrom', 'heardOther']) {
    const v = s(f, k);
    if (v !== undefined && v.trim() !== '') answers[k] = v;
  }
  answers.roles = all(f, 'roles');
  answers.workTypes = all(f, 'workTypes');
  answers.credentials = all(f, 'credentials');
  answers.availability = WEEKDAYS.map(d => ({ weekday: d.n, periods: all(f, `avail_${d.n}`) }));
  answers.consent = s(f, 'consent') === 'yes';
  const c: Record<string, unknown> = {};
  for (const q of custom) {
    if (q.type === 'file') continue;
    const v = q.type === 'multi_choice' ? all(f, `c_${q.id}`) : s(f, `c_${q.id}`);
    if (v !== undefined && !(Array.isArray(v) && !v.length) && v !== '') c[q.id] = v;
  }
  answers.custom = c;
  return answers;
}

/** Picks the files out of a submitted form by field name (only the API's names, only files that were chosen). */
export function filesFrom(entries: Iterable<[string, FormDataEntryValue]>): { field: string; file: File }[] {
  const out: { field: string; file: File }[] = [];
  for (const [k, v] of entries) {
    if (typeof v === 'string' || v.size === 0) continue;
    if (k === 'cv' || /^cred_[0-9a-f-]{36}$/.test(k) || /^q_q[a-z0-9]{4,20}$/.test(k)) out.push({ field: k, file: v });
  }
  return out;
}

/** What a form remembers when it comes back with a problem (files can't be kept). */
export function keptValues(entries: Iterable<[string, FormDataEntryValue]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || ['formToken', 'website', 'cf-turnstile-response'].includes(k)) continue;
    (out[k] ??= []).push(v);
  }
  return out;
}

/** Settings: what each mode means to the office. */
export const MODE_LABEL: Record<'off' | 'optional' | 'required', string> = { off: 'Not asked', optional: 'Optional', required: 'Required' };

/** "3 waiting for the applicant to confirm their email · 5 confirmed in the last 30 days". */
export function applySummary(waiting: number, confirmed30: number) {
  const a = waiting ? `${waiting} waiting for the applicant to confirm their email` : 'None waiting for an email to be confirmed';
  return `${a} · ${confirmed30} confirmed in the last 30 days`;
}

/** Reads "one per line" choices from Settings. */
export const choicesFromText = (t: string | null | undefined) =>
  [...new Set((t ?? '').split(/\r?\n/).map(x => x.trim()).filter(Boolean))];

/** The fixed list of states for the country (Australia, United States), else null for free text. */
export function regionsFor(country: string): readonly string[] | null {
  if (country === 'AU') return STATES;
  if (country === 'US') return US_STATES;
  return null;
}

/** An application as the office sees it on the person's page (`GET /workers/:id/applications`). */
export type JobApplication = {
  id: string; createdAt: string; confirmedAt: string; outcome: 'new_applicant' | 'existing_person'; consentVersion: string;
  answers: { label: string; value: string }[];
  files: { id: string; filename: string; label: string; sizeBytes: number }[];
};
