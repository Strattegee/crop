import type { PoolClient } from 'pg';
import type { CountryCode } from '../common/countries.js';
import { parseMobile, smsRefusal } from './phone.js';
import { pushText } from './push.js';
import { smsText } from './sms-text.js';

export interface NewNotification {
  channel: 'email' | 'sms' | 'push';
  to: string;
  template: string;
  subject?: string;
  body: string;
  workerId?: string | null;
  dedupeKey?: string | null;
  createdBy?: string | null;
}

/** Reserved example domains (RFC 2606): invented demo people use these, and they can never receive mail. */
export function isExampleAddress(email: string) {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  return /^(example\.(com|org|net)|.+\.(example|test|invalid|localhost))$/.test(domain);
}

const ZONE = "coalesce((select timezone from tenant_settings where tenant_id = $1), 'Australia/Melbourne')";
/** The SQL condition for this calendar month in the business's own time zone ($1 = tenant id). */
export const SMS_MONTH = `created_at >= date_trunc('month', now() at time zone ${ZONE}) at time zone ${ZONE}`;

/**
 * Who caused a message when the caller didn't say (David, 3 Nov 2026: "messages sent" per officer): the signed-in
 * person of the request (`app.audit_id`, always a user id); null for links and background jobs.
 */
const WHO_ACTED = `(select case when v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end
  from (select nullif(current_setting('app.audit_id', true), '') as v) a)`;

export type QueueResult = { id: string; status: 'queued' | 'skipped'; reason?: string } | { id: null; status: 'duplicate' };

/**
 * Queues a message (inside withTenant). The background sender delivers it.
 * - SMS numbers must be mobiles (read in the business's country's form); texts go to Australian mobiles only for now.
 * - Over the agency's monthly SMS limit, the message is logged as skipped instead of sent (NOT-4).
 * - SMS text is tidied first (`smsText`: plain punctuation), so a stray en dash doesn't make it Unicode and cost double.
 * - A dedupeKey that was used before means the message was already queued, so nothing happens.
 * - With real email delivery on (RESEND_API_KEY), email to example addresses (demo people) is logged as skipped.
 */
export async function queueNotification(db: PoolClient, tenantId: string, n: NewNotification): Promise<QueueResult> {
  let to = n.to.trim();
  let status: 'queued' | 'skipped' = 'queued';
  let reason: string | null = null;
  if (n.channel === 'email' && process.env.RESEND_API_KEY && isExampleAddress(to)) {
    status = 'skipped';
    reason = 'Demo person (example address): not sent';
  }
  if (n.channel === 'sms') {
    const country = (await db.query<{ country: CountryCode }>('select country from tenant_settings where tenant_id = $1', [tenantId])).rows[0]?.country ?? 'AU';
    const mobile = parseMobile(country, to);
    if (mobile) to = mobile.e164;
    const refusal = smsRefusal(mobile);
    if (refusal) {
      status = 'skipped';
      reason = refusal;
    } else {
      const cap = (await db.query<{ sms_monthly_cap: number }>('select sms_monthly_cap from tenant_settings where tenant_id = $1', [tenantId])).rows[0]?.sms_monthly_cap ?? 2000;
      const used = (await db.query<{ n: number }>(`select count(*)::int as n from notifications where channel = 'sms' and status <> 'skipped' and ${SMS_MONTH}`, [tenantId])).rows[0].n;
      if (used >= cap) {
        status = 'skipped';
        reason = 'Monthly SMS limit reached';
      }
    }
  }
  const row = (await db.query<{ id: string }>(
    `insert into notifications(tenant_id, channel, to_address, template, dedupe_key, subject, body, worker_id, status, last_error, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, coalesce($11::uuid, ${WHO_ACTED}))
     on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing
     returning id`,
    [tenantId, n.channel, to, n.template, n.dedupeKey ?? null, n.subject ?? null, n.channel === 'sms' ? smsText(n.body) : n.body, n.workerId ?? null, status, reason, n.createdBy ?? null],
  )).rows[0];
  if (!row) return { id: null, status: 'duplicate' };
  return reason ? { id: row.id, status, reason } : { id: row.id, status };
}

export interface NewPush {
  /** The person the message is about and for; it goes to every phone where their sign-in has the CROP app. */
  workerId: string;
  template: string;
  title: string;
  body: string;
  /** Required: one message per phone, never twice (the phone's id is added). */
  dedupeKey: string;
  createdBy?: string | null;
}

/**
 * Queues a push message to each phone where this person's sign-in has the CROP app (inside withTenant).
 * Nobody with the app = nothing queued. Returns how many were queued.
 */
export async function queuePush(db: PoolClient, tenantId: string, p: NewPush): Promise<number> {
  const devices = (await db.query<{ id: string; token: string }>(
    `select d.id, d.token from push_devices d join workers w on w.user_id = d.user_id and w.tenant_id = d.tenant_id
      where w.id = $1 and d.removed_at is null order by d.created_at`, [p.workerId])).rows;
  const t = pushText(p.title, p.body);
  let n = 0;
  for (const d of devices) {
    const r = await queueNotification(db, tenantId, {
      channel: 'push', to: d.token, template: p.template, subject: t.title, body: t.body,
      workerId: p.workerId, dedupeKey: `${p.dedupeKey}:push:${d.id}`, createdBy: p.createdBy ?? null,
    });
    if (r.status !== 'duplicate') n++;
  }
  return n;
}
