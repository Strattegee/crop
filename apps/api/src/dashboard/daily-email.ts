import type { PoolClient } from 'pg';
import type { Membership } from '../auth/auth.types.js';
import { queueNotification } from '../notifications/notify.js';
import { AttentionController } from '../roster/attention.controller.js';
import { T, type Words } from '../terms/words.js';
import { history, MEASURES, saveSnapshot, targetsOf } from './dashboard-data.js';
import { addDays } from '../workforce/compliance.js';
import { defaultFocus, FOCUS_LABEL, KPIS, kpisFor, SETTING_KPIS, standing, tidy, worded, type Focus, type KpiDef, type Standing } from './kpis.js';

/**
 * The daily email (David, 31 Oct: "the daily email becomes a copy of the dashboard's top items, replacing the separate
 * digests"). Each office person gets one email a day, from 8am business time, with their own dashboard's numbers
 * (off target first), what needs attention, decisions waiting on them, and (for Compliance and Overview) the dates
 * to follow up that used to come as the separate compliance digest. Nothing to act on means no email.
 * Never health details or document numbers: no credential names from the attention list's details, and the expiry
 * lines already say "a vaccination record".
 */

export interface EmailNumber { label: string; value: string; standing: Standing; target: string | null; weekAgo?: string | null }
export interface EmailAttention { when: string; title: string; where: string; urgent: boolean }
export interface DailyEmailInput {
  business: string; firstName: string; focus: Focus; dateWords: string; appUrl: string;
  numbers: EmailNumber[];
  attention: { total: number; urgent: number; items: EmailAttention[] } | null;
  decisions: { leave: number; changes: number } | null;
  expiry: { people: string[]; equipment: string[] } | null;
  words: Words;
}

const SHOWN = 5;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A value for the email: 92.5%, 3, 4.5 hours, 1 day, or "nothing yet". */
export function emailValue(value: number | null, unit: KpiDef['unit']): string {
  if (value === null) return 'nothing to measure yet';
  const v = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (unit === 'percent') return `${v}%`;
  if (unit === 'count') return v;
  return `${v} ${unit === 'hours' ? 'hour' : 'day'}${value === 1 ? '' : 's'}`;
}

/** Whether there is anything worth an email: a number off target, something needing attention, a decision or a date. */
export function worthSending(i: Pick<DailyEmailInput, 'numbers' | 'attention' | 'decisions' | 'expiry'>): boolean {
  return i.numbers.some(n => n.standing === 'off_target')
    || (i.attention?.total ?? 0) > 0
    || (i.decisions ? i.decisions.leave + i.decisions.changes > 0 : false)
    || (i.expiry ? i.expiry.people.length + i.expiry.equipment.length > 0 : false);
}

/** The email's subject and body (plain text), or null when there is nothing to act on. */
export function dailyEmail(i: DailyEmailInput): { subject: string; body: string } | null {
  if (!worthSending(i)) return null;
  const w = i.words;
  const off = i.numbers.filter(n => n.standing === 'off_target');
  const parts: string[] = [`Hi ${i.firstName},`, `Here is your ${FOCUS_LABEL[i.focus]} dashboard at ${i.business} for ${i.dateWords}.`];

  if (i.numbers.length) {
    const ordered = [...off, ...i.numbers.filter(n => n.standing !== 'off_target')];
    parts.push(['Your numbers:', ...ordered.map(n =>
      `- ${n.label}: ${n.value}${n.standing === 'off_target' ? ` (off target: ${n.target})` : n.standing === 'on_target' ? ' (on target)' : ''}${n.weekAgo ? `; a week ago ${n.weekAgo}` : ''}`)].join('\n'));
  }
  if (i.attention && i.attention.total > 0) {
    const head = `Needs attention in the next 7 days: ${i.attention.total}${i.attention.urgent ? `, ${i.attention.urgent} within a day` : ''}`;
    const lines = i.attention.items.slice(0, SHOWN).map(a => `- ${a.urgent ? 'Soon: ' : ''}${a.title}, ${a.when}, ${a.where}`);
    const more = i.attention.total > SHOWN ? [`And ${i.attention.total - SHOWN} more on the ${w.lower(T.roster)}.`] : [];
    parts.push([head, ...lines, ...more].join('\n'));
  }
  if (i.decisions && i.decisions.leave + i.decisions.changes > 0) {
    const d: string[] = [];
    if (i.decisions.leave) d.push(`- ${plural(i.decisions.leave, 'leave request', 'leave requests')}`);
    if (i.decisions.changes) d.push(`- ${plural(i.decisions.changes, `${w.lower(T.roster)} change request`, `${w.lower(T.roster)} change requests`)}`);
    parts.push(['Waiting on your decision:', ...d].join('\n'));
  }
  if (i.expiry && i.expiry.people.length + i.expiry.equipment.length > 0) {
    const s: string[] = ['Dates to follow up:'];
    if (i.expiry.people.length) s.push(`${i.expiry.equipment.length ? 'People:\n' : ''}${i.expiry.people.join('\n')}`);
    if (i.expiry.equipment.length) s.push(`${w.one(T.equipment)}:\n${i.expiry.equipment.join('\n')}\nRecord the new date against the ${w.lower(T.equipment)} in CROP once it's done.`);
    parts.push(s.join('\n'));
  }
  parts.push(i.appUrl ? `Open your dashboard: ${i.appUrl}/dashboard` : 'Open your Dashboard in CROP.');
  parts.push(`You get this email because you work in the office at ${i.business}. It only comes when something needs you.`);

  const bits: string[] = [];
  if (i.attention?.urgent) bits.push(`${i.attention.urgent} within a day`);
  else if (i.attention?.total) bits.push(`${i.attention.total} to look at`);
  if (off.length) bits.push(plural(off.length, 'number off target', 'numbers off target'));
  const dates = i.expiry ? i.expiry.people.length + i.expiry.equipment.length : 0;
  if (dates) bits.push(plural(dates, 'date to follow up', 'dates to follow up'));
  if (i.decisions && i.decisions.leave + i.decisions.changes) bits.push(plural(i.decisions.leave + i.decisions.changes, 'decision', 'decisions'));
  return { subject: `${FOCUS_LABEL[i.focus]} dashboard: ${bits.join(', ') || 'today'}`, body: parts.join('\n\n') };
}

type Member = { user_id: string; name: string; email: string; role: string; focus: Focus | null };

/**
 * Queues today's email for every office person in the business (inside withTenant). `expiry` is the follow-up list
 * worked out by the expiry reminders (new since it was last reported). Returns how many emails were queued and
 * whether anyone was given the dates (so the reminders mark them reported only then).
 */
export async function queueDailyEmails(
  pool: import('pg').Pool, db: PoolClient, tenantId: string, business: string, today: string, words: Words,
  expiry: { people: string[]; equipment: string[] },
): Promise<{ queued: number; datesSent: boolean }> {
  const team = (await db.query<Member>('select user_id, name, email, role, focus from app_office_team()')).rows;
  if (!team.length) return { queued: 0, datesSent: false };
  // The run is hourly: once everyone has had today's email and today's numbers are kept, there is nothing left to do.
  const done = (await db.query<{ n: number; kept: boolean }>(
    `select (select count(*)::int from notifications where dedupe_key = any($1)) as n,
            exists (select 1 from dashboard_snapshots where day = $2) as kept`,
    [team.map(m => `daily:${today}:${m.user_id}`), today])).rows[0];
  if (done.n >= team.length && done.kept) return { queued: 0, datesSent: false };
  const focusOf = (m: Member) => m.focus ?? defaultFocus(m.role);
  // The dates go to the Compliance and Overview people; when nobody has those, to owners and admins as before.
  const dateTakers = new Set(team.filter(m => ['compliance', 'overview'].includes(focusOf(m))).map(m => m.user_id));
  if (!dateTakers.size) for (const m of team) if (m.role === 'owner' || m.role === 'admin') dateTakers.add(m.user_id);

  const targets = await targetsOf(db);
  const say = (x: string) => worded(x, words, T);
  let attentionCache: { total: number; urgent: number; items: EmailAttention[]; blocked: number } | null = null;
  const attention = async () => {
    if (attentionCache) return attentionCache;
    const a = await new AttentionController(pool).attention({ tenantId } as Membership, { days: '7' }) as {
      total: number; urgent: number; byKind: Record<string, number>;
      items: { kind: string; urgent: boolean; title: string; startsIn: string; shift: { facilityName: string; role: string; localDate: string; localStart: string } }[];
    };
    const shiftWord = words.lower(T.shift);
    attentionCache = {
      total: a.total, urgent: a.urgent, blocked: a.byKind?.person_blocked ?? 0,
      items: a.items.map(x => ({
        urgent: x.urgent,
        // Cover gaps name a credential; the email keeps to plain words (details are in CROP).
        title: x.kind === 'cover_gap' ? 'A cover gap' : x.title.replace(/\bshift\b/g, shiftWord),
        when: `${x.shift.localDate} ${x.shift.localStart} ${x.shift.role}`,
        where: `${x.shift.facilityName} (${x.startsIn})`,
      })),
    };
    return attentionCache;
  };
  const measured = new Map<string, number | null>();
  const measure = async (def: KpiDef) => {
    if (!measured.has(def.key)) {
      const m = await MEASURES[def.key](db, { tenantId, targets, blockedShifts: async () => (await attention()).blocked });
      measured.set(def.key, tidy(m.value, def.unit));
    }
    return measured.get(def.key)!;
  };
  // Keep today's value of every measure (for "a week ago" and the dashboard's trend lines), and read last week's.
  const all = KPIS.filter(k => !SETTING_KPIS.has(k.key));
  for (const def of all) await saveSnapshot(db, tenantId, today, def.key, await measure(def));
  const lastWeek = await history(db, all.map(k => k.key), [addDays(today, -7)]);
  const decisions = {
    leave: (await db.query<{ n: number }>(`select count(*)::int as n from leave_records where status = 'requested'`)).rows[0].n,
    changes: (await db.query<{ n: number }>(`select count(*)::int as n from roster_change_requests where status = 'pending'`)).rows[0].n,
  };
  const dateWords = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${today}T00:00:00Z`));
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');

  let queued = 0; let datesSent = false;
  for (const m of team) {
    const focus = focusOf(m);
    const numbers: EmailNumber[] = [];
    for (const def of kpisFor(focus)) {
      const value = await measure(def);
      const target = targets.get(def.key) ?? null;
      const st = standing(value, target, def.better);
      numbers.push({ label: say(def.label), value: emailValue(value, def.unit), standing: st,
        target: target === null ? null : `${def.better === 'higher' ? 'at least' : 'at most'} ${emailValue(target, def.unit)}`,
        weekAgo: (() => { const v = lastWeek.get(def.key)?.[0] ?? null; return v === null ? null : emailValue(v, def.unit); })() });
    }
    const wantsAttention = focus === 'allocator' || focus === 'overview';
    const gets = dateTakers.has(m.user_id);
    const mail = dailyEmail({
      business, firstName: m.name.split(/[\s@]/)[0], focus, dateWords, appUrl, words, numbers,
      attention: wantsAttention ? await attention() : null,
      decisions: m.role === 'owner' || m.role === 'admin' ? decisions : null,
      expiry: gets ? expiry : null,
    });
    if (!mail) continue;
    const r = await queueNotification(db, tenantId, { channel: 'email', to: m.email, template: 'daily_dashboard',
      dedupeKey: `daily:${today}:${m.user_id}`, subject: mail.subject, body: mail.body });
    if (r.status === 'duplicate') continue; // already had today's email: new dates wait for tomorrow's
    queued++;
    if (gets && expiry.people.length + expiry.equipment.length > 0) datesSent = true;
  }
  return { queued, datesSent };
}
