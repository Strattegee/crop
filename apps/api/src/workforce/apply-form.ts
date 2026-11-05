/**
 * Applying online (David approved 5 Nov 2026; backlog item 11; spam protection decided 29 Oct; migration 0094).
 * Pure rules: the business's form (CROP's starter questions plus its own), reading what an applicant sends, the
 * spam checks (signed "opened at" stamp, limits, confirmation link) and the messages. No database access here.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { COUNTRIES, normalPostcode, type CountryCode } from '../common/countries.js';
import { parseMobile, MOBILE_EXAMPLE } from '../notifications/phone.js';
import { PERIODS, type Period } from '../roster/availability.js';

// ---------------------------------------------------------------- the form

export const MODES = ['off', 'optional', 'required'] as const;
export type Mode = (typeof MODES)[number];

export const BUILT_IN_KEYS = [
  'name', 'email', 'mobile', 'home', 'roles', 'work_type', 'availability', 'right_to_work', 'licence_car', 'credentials', 'about', 'cv', 'heard', 'consent',
] as const;
export type BuiltInKey = (typeof BUILT_IN_KEYS)[number];

export interface BuiltInRule {
  label: string;
  /** What the office sees under the question in Settings. */
  note: string;
  defaultMode: Mode;
  /** Modes the business may choose; a single mode = always asked like that. */
  allowed: readonly Mode[];
}

/** CROP's starter questions (David, 5 Nov) in the order the form asks them. */
export const BUILT_IN: Record<BuiltInKey, BuiltInRule> = {
  name: { label: 'Name', note: 'First and last name. Always asked.', defaultMode: 'required', allowed: ['required'] },
  email: { label: 'Email', note: 'Always asked: they confirm it before you see the application.', defaultMode: 'required', allowed: ['required'] },
  mobile: { label: 'Mobile', note: 'Checked as a mobile number for your country.', defaultMode: 'required', allowed: MODES },
  home: { label: 'Suburb and postcode', note: 'Where they live, so CROP can show how far they are from your sites. No street address.', defaultMode: 'required', allowed: MODES },
  roles: { label: 'Roles applied for', note: 'From your role list, grouped by industry. Not shown when you have no roles yet.', defaultMode: 'required', allowed: MODES },
  work_type: { label: 'Kind of work', note: 'Full-time, part-time or casual (any of them).', defaultMode: 'optional', allowed: MODES },
  availability: { label: 'Usual availability', note: 'Each day: morning, afternoon, night. Becomes their usual week.', defaultMode: 'optional', allowed: MODES },
  right_to_work: { label: 'Right to work', note: 'Yes or no, and their status. No numbers or visa details: you record and check it properly later.', defaultMode: 'required', allowed: MODES },
  licence_car: { label: 'Driver’s licence and car', note: 'Two yes/no questions.', defaultMode: 'optional', allowed: MODES },
  credentials: { label: 'Qualifications and tickets', note: 'They tick what they hold from your list (vaccinations aren’t asked), with a photo or file of each if they like. Added unchecked.', defaultMode: 'optional', allowed: ['off', 'optional'] },
  about: { label: 'About you', note: 'A few lines in their own words.', defaultMode: 'optional', allowed: MODES },
  cv: { label: 'CV or résumé', note: 'One file.', defaultMode: 'optional', allowed: MODES },
  heard: { label: 'How they heard about you', note: 'A choice, or something else.', defaultMode: 'optional', allowed: MODES },
  consent: { label: 'Privacy', note: 'They agree to the privacy policy and worker privacy notice. Always asked.', defaultMode: 'required', allowed: ['required'] },
};

export const CUSTOM_TYPES = ['short_text', 'long_text', 'yes_no', 'choice', 'multi_choice', 'file'] as const;
export type CustomType = (typeof CUSTOM_TYPES)[number];
export const CUSTOM_TYPE_LABEL: Record<CustomType, string> = {
  short_text: 'Short answer', long_text: 'Longer answer', yes_no: 'Yes or no', choice: 'Pick one', multi_choice: 'Pick any', file: 'File or photo',
};
export const MAX_CUSTOM = 30;
export const MAX_CHOICES = 20;

export interface CustomQuestion { id: string; label: string; help: string | null; type: CustomType; required: boolean; choices: string[] }
export interface StoredQuestions { builtIn?: Partial<Record<BuiltInKey, Mode>>; custom?: CustomQuestion[] }
export interface ApplyForm { builtIn: Record<BuiltInKey, Mode>; custom: CustomQuestion[] }

/** The form with CROP's defaults filled in (stored = only what the business chose). */
export function formOf(stored: StoredQuestions | null | undefined): ApplyForm {
  const builtIn = {} as Record<BuiltInKey, Mode>;
  for (const k of BUILT_IN_KEYS) {
    const chosen = stored?.builtIn?.[k];
    builtIn[k] = chosen && BUILT_IN[k].allowed.includes(chosen) ? chosen : BUILT_IN[k].defaultMode;
  }
  return { builtIn, custom: Array.isArray(stored?.custom) ? stored!.custom : [] };
}

export class FormProblem extends Error {}
const formProblem = (m: string): never => { throw new FormProblem(m); };

const cleanText = (v: unknown, max: number, what: string): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return formProblem(`${what} must be text`);
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length > max) formProblem(`${what} is too long (at most ${max} characters)`);
  return t || null;
};

/** Reads the starter questions' modes from Settings (`{mobile: 'optional', …}`); unknown keys or modes are refused. */
export function parseBuiltIn(raw: unknown, current: ApplyForm['builtIn']): ApplyForm['builtIn'] {
  if (raw === undefined || raw === null) return current;
  if (typeof raw !== 'object' || Array.isArray(raw)) return formProblem('Questions must be a list of choices');
  const out = { ...current };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(BUILT_IN_KEYS as readonly string[]).includes(k)) formProblem(`There is no question called ${k}`);
    const rule = BUILT_IN[k as BuiltInKey];
    if (typeof v !== 'string' || !rule.allowed.includes(v as Mode)) formProblem(`${rule.label} can be ${rule.allowed.join(', ')}`);
    out[k as BuiltInKey] = v as Mode;
  }
  return out;
}

/**
 * Reads the business's own questions (the whole list, in order). A question without an id gets a new one; ids are
 * kept so answers already given stay matched. Choices are needed for pick-one and pick-any questions.
 */
export function parseCustom(raw: unknown, newId: () => string = () => `q${randomUUID().replace(/-/g, '').slice(0, 10)}`): CustomQuestion[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return formProblem('Your questions must be a list');
  if (raw.length > MAX_CUSTOM) formProblem(`At most ${MAX_CUSTOM} questions of your own`);
  const seen = new Set<string>();
  return raw.map((q, i) => {
    const r = (q ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const label = cleanText(r.label, 200, `Question ${n}`);
    if (!label) formProblem(`Question ${n} needs some words`);
    const type = r.type as CustomType;
    if (!(CUSTOM_TYPES as readonly string[]).includes(type)) formProblem(`Choose what kind of answer question ${n} takes`);
    let id = typeof r.id === 'string' && /^q[a-z0-9]{4,20}$/.test(r.id) ? r.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    let choices: string[] = [];
    if (type === 'choice' || type === 'multi_choice') {
      if (!Array.isArray(r.choices)) formProblem(`Question ${n} needs its choices`);
      choices = [...new Set((r.choices as unknown[]).map(c => cleanText(c, 100, `A choice in question ${n}`)).filter((c): c is string => !!c))];
      if (choices.length < 2) formProblem(`Question ${n} needs at least two choices`);
      if (choices.length > MAX_CHOICES) formProblem(`Question ${n} can have at most ${MAX_CHOICES} choices`);
    }
    return { id, label: label!, help: cleanText(r.help, 300, `The note under question ${n}`), type, required: r.required === true, choices };
  });
}

// ---------------------------------------------------------------- answers

export const WORK_TYPES = ['full_time', 'part_time', 'casual'] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_TYPE_LABEL: Record<WorkType, string> = { full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual' };

export const RTW_STATUSES = ['citizen', 'nz_citizen', 'permanent_resident', 'visa_holder'] as const;
export type RtwStatus = (typeof RTW_STATUSES)[number];
/** The statuses offered in a business's country (NZ citizens are only a separate status in Australia). */
export const rtwStatusesFor = (country: CountryCode): RtwStatus[] => (country === 'AU' ? [...RTW_STATUSES] : ['citizen', 'permanent_resident', 'visa_holder']);
export function rtwStatusLabel(s: RtwStatus, country: CountryCode): string {
  if (s === 'citizen') return country === 'AU' ? 'Australian citizen' : country === 'NZ' ? 'New Zealand citizen' : country === 'US' ? 'US citizen' : 'British citizen';
  if (s === 'nz_citizen') return 'New Zealand citizen';
  if (s === 'permanent_resident') return 'Permanent resident';
  return 'Visa holder';
}

export const HEARD_CHOICES = ['search', 'social', 'job_site', 'word_of_mouth', 'staff', 'other'] as const;
export type Heard = (typeof HEARD_CHOICES)[number];
export const HEARD_LABEL: Record<Heard, string> = {
  search: 'Searching online', social: 'Social media', job_site: 'A job website', word_of_mouth: 'A friend or family member',
  staff: 'Someone who works here', other: 'Somewhere else',
};

export interface ApplyContext {
  country: CountryCode;
  /** The business's active role names (exact). */
  roles: string[];
  /** Credential types they may say they hold (active, not vaccinations). */
  credentialTypeIds: string[];
}

export interface CustomAnswer { id: string; label: string; type: CustomType; value: string | string[] | null }

export interface ApplicationInput {
  firstName: string; lastName: string; email: string; mobile: string | null;
  suburb: string | null; region: string | null; postcode: string | null; country: CountryCode;
  roles: string[]; workTypes: WorkType[]; availability: { weekday: number; periods: Period[] }[] | null;
  rightToWork: 'yes' | 'no' | null; rightToWorkStatus: RtwStatus | null;
  driversLicence: boolean | null; ownCar: boolean | null;
  credentialTypeIds: string[]; about: string | null; heardFrom: Heard | null; heardOther: string | null;
  custom: CustomAnswer[];
  /** Field names of the files allowed with these answers: `cv`, `cred_<typeId>`, `q_<questionId>`. */
  fileFields: string[];
}

export class ApplyProblem extends Error {}
const problem = (m: string): never => { throw new ApplyProblem(m); };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_FILES = 10;

function str(v: unknown, max: number, what: string, required: boolean): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return required ? problem(`${what} is needed`) : null;
  if (typeof v !== 'string') return problem(`${what} must be text`);
  const t = v.trim().replace(/[ \t]+/g, ' ');
  if (t.length > max) problem(`${what} is too long (at most ${max} characters)`);
  return t;
}
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? [v.trim()] : []);
function yesNo(v: unknown, what: string, required: boolean): 'yes' | 'no' | null {
  if (v === true || v === 'yes') return 'yes';
  if (v === false || v === 'no') return 'no';
  if (v === undefined || v === null || v === '') return required ? problem(`Answer ${what}`) : null;
  return problem(`Answer ${what} with yes or no`);
}

/** Labels that follow the business's country (also used by the web). */
export function homeLabels(country: CountryCode) {
  if (country === 'US') return { suburb: 'City or town', region: 'State', postcode: 'ZIP code' };
  if (country === 'GB') return { suburb: 'Town or city', region: 'County', postcode: 'Postcode' };
  if (country === 'NZ') return { suburb: 'Suburb or town', region: 'Region', postcode: 'Postcode' };
  return { suburb: 'Suburb', region: 'State', postcode: 'Postcode' };
}

/**
 * Reads what an applicant sent against the business's form. `files` = the names of the file fields that came with
 * it. Throws `ApplyProblem` with a message for the applicant. Questions switched off are ignored even when sent.
 */
export function parseApplication(raw: Record<string, unknown> | null | undefined, form: ApplyForm, ctx: ApplyContext, files: string[] = []): ApplicationInput {
  const a = raw ?? {};
  const on = (k: BuiltInKey) => form.builtIn[k] !== 'off';
  const req = (k: BuiltInKey) => form.builtIn[k] === 'required';
  const firstName = str(a.firstName, 100, 'First name', true)!;
  const lastName = str(a.lastName, 100, 'Last name', true)!;
  const email = str(a.email, 254, 'Email', true)!.toLowerCase();
  if (!EMAIL.test(email)) problem('Your email doesn’t look right');

  let mobile: string | null = null;
  if (on('mobile')) {
    const m = str(a.mobile, 30, 'Mobile', req('mobile'));
    if (m) {
      const p = parseMobile(ctx.country, m);
      if (!p) problem(`Your mobile doesn’t look right (for example ${MOBILE_EXAMPLE[ctx.country]})`);
      mobile = p!.e164;
    }
  }

  let suburb: string | null = null, region: string | null = null, postcode: string | null = null;
  if (on('home')) {
    const c = COUNTRIES[ctx.country];
    const labels = homeLabels(ctx.country);
    suburb = str(a.suburb, 100, labels.suburb, req('home'));
    postcode = str(a.postcode, 10, labels.postcode, req('home') && ctx.country !== 'GB');
    region = str(a.region, 60, labels.region, false);
    if (postcode) {
      postcode = normalPostcode(ctx.country, postcode);
      if (!c.postcode.test(postcode)) problem(`${labels.postcode}: ${c.postcodeHint}`);
    }
    if (region && c.regions) {
      region = region.toUpperCase().replace(/\.$/, '');
      if (!c.regions.includes(region)) problem(`Choose a ${labels.region.toLowerCase()}`);
    }
  }

  let roles: string[] = [];
  if (on('roles') && ctx.roles.length) {
    roles = [...new Set(list(a.roles))];
    if (roles.some(r => !ctx.roles.includes(r))) problem('Choose roles from the list');
    if (req('roles') && !roles.length) problem('Choose the roles you’re applying for');
  }

  let workTypes: WorkType[] = [];
  if (on('work_type')) {
    workTypes = WORK_TYPES.filter(w => list(a.workTypes).includes(w));
    if (list(a.workTypes).some(w => !(WORK_TYPES as readonly string[]).includes(w))) problem('Choose full-time, part-time or casual');
    if (req('work_type') && !workTypes.length) problem('Choose the kind of work you’re after');
  }

  let availability: ApplicationInput['availability'] = null;
  if (on('availability')) {
    const days = Array.isArray(a.availability) ? a.availability : [];
    const out: { weekday: number; periods: Period[] }[] = [];
    for (const d of days) {
      const r = (d ?? {}) as Record<string, unknown>;
      const wd = Number(r.weekday);
      const periods = list(r.periods);
      if (!Number.isInteger(wd) || wd < 1 || wd > 7 || out.some(x => x.weekday === wd)) problem('Availability: each day once, Monday to Sunday');
      if (periods.some(p => !(PERIODS as readonly string[]).includes(p))) problem('Availability: morning, afternoon or night');
      out.push({ weekday: wd, periods: PERIODS.filter(p => periods.includes(p)) });
    }
    const any = out.some(d => d.periods.length);
    if (req('availability') && !any) problem('Tick when you can usually work');
    // Every day is recorded once they've said anything: a day left unticked means "not that day".
    availability = any ? [1, 2, 3, 4, 5, 6, 7].map(wd => out.find(d => d.weekday === wd) ?? { weekday: wd, periods: [] }) : null;
  }

  let rightToWork: 'yes' | 'no' | null = null, rightToWorkStatus: RtwStatus | null = null;
  if (on('right_to_work')) {
    rightToWork = yesNo(a.rightToWork, `whether you have the right to work in ${COUNTRIES[ctx.country].name}`, req('right_to_work'));
    if (rightToWork === 'yes') {
      const s = str(a.rightToWorkStatus, 30, 'Right to work status', true);
      if (!rtwStatusesFor(ctx.country).includes(s as RtwStatus)) problem('Choose your right to work status');
      rightToWorkStatus = s as RtwStatus;
    }
  }

  let driversLicence: boolean | null = null, ownCar: boolean | null = null;
  if (on('licence_car')) {
    const l = yesNo(a.driversLicence, 'whether you have a driver’s licence', req('licence_car'));
    const c = yesNo(a.ownCar, 'whether you have your own car', req('licence_car'));
    driversLicence = l === null ? null : l === 'yes';
    ownCar = c === null ? null : c === 'yes';
  }

  let credentialTypeIds: string[] = [];
  if (on('credentials')) {
    credentialTypeIds = [...new Set(list(a.credentials))];
    // A file sent for one counts as ticking it.
    for (const f of files) if (f.startsWith('cred_') && !credentialTypeIds.includes(f.slice(5))) credentialTypeIds.push(f.slice(5));
    if (credentialTypeIds.some(id => !ctx.credentialTypeIds.includes(id))) problem('Choose qualifications from the list');
  }

  const about = on('about') ? str(a.about, 2000, 'About you', req('about')) : null;

  let heardFrom: Heard | null = null, heardOther: string | null = null;
  if (on('heard')) {
    const h = str(a.heardFrom, 30, 'How you heard about us', req('heard'));
    if (h) {
      if (!(HEARD_CHOICES as readonly string[]).includes(h)) problem('Choose how you heard about us');
      heardFrom = h as Heard;
      heardOther = h === 'other' ? str(a.heardOther, 200, 'Where you heard about us', false) : null;
    }
  }

  const customRaw = (a.custom && typeof a.custom === 'object' && !Array.isArray(a.custom) ? a.custom : {}) as Record<string, unknown>;
  const custom: CustomAnswer[] = form.custom.map(q => {
    const v = customRaw[q.id];
    const what = `“${q.label}”`;
    let value: string | string[] | null = null;
    if (q.type === 'short_text' || q.type === 'long_text') {
      value = str(v, q.type === 'short_text' ? 200 : 2000, what, false);
      if (!value && q.required) problem(`Answer ${what}`);
    }
    else if (q.type === 'yes_no') value = yesNo(v, what, q.required);
    else if (q.type === 'choice') {
      value = str(v, 100, what, false);
      if (value && !q.choices.includes(value)) problem(`Choose an answer to ${what} from the list`);
      if (!value && q.required) problem(`Answer ${what}`);
    } else if (q.type === 'multi_choice') {
      const vs = [...new Set(list(v))];
      if (vs.some(x => !q.choices.includes(x))) problem(`Choose answers to ${what} from the list`);
      if (q.required && !vs.length) problem(`Answer ${what}`);
      value = vs.length ? q.choices.filter(c => vs.includes(c)) : null;
    } else {
      const has = files.includes(`q_${q.id}`);
      if (q.required && !has) problem(`Add a file for ${what}`);
      value = has ? 'file' : null;
    }
    return { id: q.id, label: q.label, type: q.type, value };
  });

  if (a.consent !== true && a.consent !== 'yes' && a.consent !== 'on') problem('Please agree to the privacy policy and worker privacy notice');

  // Files: only for questions asked.
  const allowed = new Set<string>();
  if (on('cv')) allowed.add('cv');
  for (const id of credentialTypeIds) allowed.add(`cred_${id}`);
  for (const q of form.custom) if (q.type === 'file') allowed.add(`q_${q.id}`);
  if (files.some(f => !allowed.has(f))) problem('A file was sent for something the form doesn’t ask for');
  if (req('cv') && !files.includes('cv')) problem('Add your CV');
  if (files.length > MAX_FILES) problem(`Send at most ${MAX_FILES} files`);

  return {
    firstName, lastName, email, mobile, suburb, region, postcode, country: ctx.country, roles, workTypes, availability,
    rightToWork, rightToWorkStatus, driversLicence, ownCar, credentialTypeIds, about, heardFrom, heardOther, custom,
    fileFields: files.filter(f => allowed.has(f)),
  };
}

// ---------------------------------------------------------------- spam protection

/** Under this many seconds between opening the form and sending it, a person can't have filled it in. */
export const MIN_SECONDS = 4;
/** A form left open longer than this must be opened again. */
export const MAX_FORM_HOURS = 24;
export const MAX_PER_IP_HOUR = 5;
export const MAX_PER_BUSINESS_HOUR = 30;
export const MAX_PER_EMAIL_DAY = 3;

const mac = (key: Buffer, s: string) => createHmac('sha256', key).update(s, 'utf8').digest('base64url').slice(0, 32);

/** The stamp the form carries: when it was opened, signed with the business's form key. */
export function formToken(key: Buffer, slug: string, nowMs: number): string {
  const t = Math.floor(nowMs / 1000).toString(36);
  return `${t}.${mac(key, `${slug}.${t}`)}`;
}

/** Why a submission's stamp is refused, or null: missing or tampered, too fast, or the form was open too long. */
export function formTokenRefusal(token: unknown, key: Buffer, slug: string, nowMs: number): string | null {
  const again = 'Please open the form again and send it from there.';
  if (typeof token !== 'string' || !/^[0-9a-z]{1,10}\.[A-Za-z0-9_-]{32}$/.test(token)) return again;
  const [t, sig] = token.split('.');
  const want = Buffer.from(mac(key, `${slug}.${t}`));
  if (!timingSafeEqual(want, Buffer.from(sig))) return again;
  const age = nowMs / 1000 - parseInt(t, 36);
  if (age < MIN_SECONDS) return 'That was very quick. Please check your answers and send it again.';
  if (age > MAX_FORM_HOURS * 3600) return 'This form has been open a long time. Please open it again (your answers will need to be filled in again).';
  return null;
}

/** The applicant's IP address as kept for the hourly limit: a keyed hash, never the address itself. */
export const ipHash = (key: Buffer, ip: string) => createHmac('sha256', key).update(`ip:${ip.trim()}`, 'utf8').digest();

/** The client's address from the request: the first X-Forwarded-For entry (set by Caddy or the web server), else the socket's. */
export function clientIp(forwarded: string | string[] | undefined, socket: string | undefined): string {
  const f = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim();
  return (f || socket || 'unknown').replace(/^::ffff:/, '').slice(0, 64);
}

/** Why the form won't take another application right now, or null. */
export function applyFloodRefusal(c: { ipHour: number; businessHour: number; emailDay: number }): string | null {
  if (c.ipHour >= MAX_PER_IP_HOUR) return 'We’ve received several applications from your connection this hour. Please try again later.';
  if (c.businessHour >= MAX_PER_BUSINESS_HOUR) return 'We’re receiving a lot of applications right now. Please try again in an hour.';
  if (c.emailDay >= MAX_PER_EMAIL_DAY) return 'We already have applications from this email today. Check your inbox for the confirmation email.';
  return null;
}

/** A filled "leave this empty" field means a robot filled the form: accept quietly and keep nothing. */
export function looksAutomated(body: Record<string, unknown> | null | undefined): boolean {
  const v = body?.website;
  return typeof v === 'string' && v.trim() !== '';
}

// ---------------------------------------------------------------- Cloudflare Turnstile (optional)

/** Turnstile is on only when both keys are set (David adds them after creating the free widget). */
export function turnstileKeys(env: Record<string, string | undefined>): { siteKey: string; secret: string } | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  return siteKey && secret ? { siteKey, secret } : null;
}

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
type FetchLike = (url: string, init: { method: string; body: URLSearchParams; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Asks Cloudflare whether the token is good. Any failure (no token, network, a "no") counts as not passed. */
export async function verifyTurnstile(secret: string, token: unknown, ip: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const r = await fetchFn(TURNSTILE_VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    return (await r.json() as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- confirmation link

export const CONFIRM_HOURS = 48;
export const CONFIRM_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const hashConfirmToken = (token: string) => createHash('sha256').update(token, 'utf8').digest();
export function newConfirmLink() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashConfirmToken(token) };
}
export const confirmUrl = (appUrl: string, slug: string, token: string) => `${appUrl.replace(/\/$/, '')}/apply/${slug}/confirm/${token}`;

export type ConfirmState = 'ok' | 'expired' | 'confirmed';
export function confirmState(a: { status: string; linkExpiresAt: Date | string }, now = new Date()): ConfirmState {
  if (a.status === 'confirmed') return 'confirmed';
  return new Date(a.linkExpiresAt).getTime() <= now.getTime() ? 'expired' : 'ok';
}

// ---------------------------------------------------------------- messages

/** The email asking the applicant to confirm. Only their first name and the business; nothing they answered. */
export function confirmEmail(p: { firstName: string; business: string; url: string }) {
  return {
    subject: `Please confirm your application to ${p.business}`,
    body: [
      `Hi ${p.firstName},`,
      '',
      `Thanks for applying to work with ${p.business}. Please confirm it's you by opening this link within ${CONFIRM_HOURS} hours:`,
      '',
      p.url,
      '',
      `${p.business} only sees your application once you've confirmed it. If you didn't apply, ignore this email and nothing will be kept.`,
      '',
      'CROP Workforce Management, on behalf of ' + p.business,
    ].join('\n'),
  };
}

/** The short "we've got it" once they've confirmed. */
export function thanksEmail(p: { firstName: string; business: string }) {
  return {
    subject: `${p.business} has your application`,
    body: [
      `Hi ${p.firstName},`,
      '',
      `Your application to ${p.business} is confirmed and with their team now. They'll be in touch.`,
      '',
      'CROP Workforce Management, on behalf of ' + p.business,
    ].join('\n'),
  };
}

/**
 * Tells the office a confirmed application arrived: the name, roles and a link. Never the answers themselves (right
 * to work, notes, files stay in CROP).
 */
export function officeEmail(p: { name: string; roles: string[]; workerId: string; existing: string | null }, appUrl: string) {
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/workers/${p.workerId}` : '';
  const roles = p.roles.length ? ` for ${p.roles.join(', ')}` : '';
  return {
    subject: p.existing ? `${p.name} applied online again` : `New application: ${p.name}`,
    body: [
      p.existing
        ? `${p.name} applied online${roles}. They're already on file (${p.existing}), so the application has been added to their record and nothing on it was changed.`
        : `${p.name} applied online${roles} and confirmed their email. They're on the recruitment board at Applied.`,
      '',
      link ? `Their application: ${link}` : 'Their application is on their page in CROP.',
      '',
      'CROP Workforce Management',
    ].join('\n'),
  };
}

const PERIOD_WORD: Record<Period, string> = { am: 'AM', pm: 'PM', night: 'Night' };
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon AM PM · Wed Night", or "None ticked". */
export function availabilityLine(days: { weekday: number; periods: string[] }[] | null): string {
  const on = (days ?? []).filter(d => d.periods.length);
  if (!on.length) return 'None ticked';
  return on.map(d => `${DAY[d.weekday]} ${d.periods.map(p => PERIOD_WORD[p as Period] ?? p).join(' ')}`).join(' · ');
}

export interface AnswerLine { label: string; value: string }

/**
 * The answers as the office reads them on the person's page. Their right to work is only what they said
 * ("Says: Australian citizen, not checked"). `credentialNames` maps type ids to names.
 */
export function answerLines(a: ApplicationInput, credentialNames: Map<string, string>, homeCountry: CountryCode): AnswerLine[] {
  const out: AnswerLine[] = [];
  const yn = (b: boolean | null) => (b === null ? null : b ? 'Yes' : 'No');
  const add = (label: string, value: string | null | undefined) => { if (value) out.push({ label, value }); };
  add('Mobile', a.mobile);
  const place = [a.suburb, [a.region, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  add('Lives in', place ? `${place}${a.country !== homeCountry ? `, ${COUNTRIES[a.country].name}` : ''}` : null);
  add('Roles', a.roles.join(', ') || null);
  add('Kind of work', a.workTypes.map(w => WORK_TYPE_LABEL[w]).join(', ') || null);
  if (a.availability) add('Usual availability', availabilityLine(a.availability));
  if (a.rightToWork === 'yes') add('Right to work', `Says: ${a.rightToWorkStatus ? rtwStatusLabel(a.rightToWorkStatus, a.country) : 'yes'} – not checked`);
  if (a.rightToWork === 'no') add('Right to work', 'Says they don’t have it – not checked');
  add('Driver’s licence', yn(a.driversLicence));
  add('Own car', yn(a.ownCar));
  add('Qualifications they say they hold', a.credentialTypeIds.map(id => credentialNames.get(id) ?? 'A qualification no longer on your list').join(', ') || null);
  add('About them', a.about);
  if (a.heardFrom) add('Heard about you', a.heardFrom === 'other' && a.heardOther ? `${HEARD_LABEL.other}: ${a.heardOther}` : HEARD_LABEL[a.heardFrom]);
  for (const c of a.custom) {
    if (c.value === null || c.type === 'file') continue;
    add(c.label, Array.isArray(c.value) ? c.value.join(', ') : c.type === 'yes_no' ? (c.value === 'yes' ? 'Yes' : 'No') : c.value);
  }
  return out;
}
