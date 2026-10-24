import type { PoolClient } from 'pg';
import { auMobile } from './phone.js';

export interface NewNotification {
  channel: 'email' | 'sms';
  to: string;
  template: string;
  subject?: string;
  body: string;
  workerId?: string | null;
  dedupeKey?: string | null;
  createdBy?: string | null;
}

export type QueueResult = { id: string; status: 'queued' | 'skipped'; reason?: string } | { id: null; status: 'duplicate' };

/**
 * Queues a message (inside withTenant). The background sender delivers it.
 * - SMS numbers must be Australian mobiles.
 * - Over the agency's monthly SMS limit, the message is logged as skipped instead of sent (NOT-4).
 * - A dedupeKey that was used before means the message was already queued, so nothing happens.
 */
export async function queueNotification(db: PoolClient, tenantId: string, n: NewNotification): Promise<QueueResult> {
  let to = n.to.trim();
  let status: 'queued' | 'skipped' = 'queued';
  let reason: string | null = null;
  if (n.channel === 'sms') {
    const mobile = auMobile(to);
    if (!mobile) {
      status = 'skipped';
      reason = 'Not an Australian mobile number';
    } else {
      to = mobile;
      const cap = (await db.query<{ sms_monthly_cap: number }>('select sms_monthly_cap from tenant_settings where tenant_id = $1', [tenantId])).rows[0]?.sms_monthly_cap ?? 2000;
      const used = (await db.query<{ n: number }>(
        `select count(*)::int as n from notifications
          where channel = 'sms' and status <> 'skipped' and created_at >= date_trunc('month', now() at time zone 'Australia/Melbourne') at time zone 'Australia/Melbourne'`,
      )).rows[0].n;
      if (used >= cap) {
        status = 'skipped';
        reason = 'Monthly SMS limit reached';
      }
    }
  }
  const row = (await db.query<{ id: string }>(
    `insert into notifications(tenant_id, channel, to_address, template, dedupe_key, subject, body, worker_id, status, last_error, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing
     returning id`,
    [tenantId, n.channel, to, n.template, n.dedupeKey ?? null, n.subject ?? null, n.body, n.workerId ?? null, status, reason, n.createdBy ?? null],
  )).rows[0];
  if (!row) return { id: null, status: 'duplicate' };
  return reason ? { id: row.id, status, reason } : { id: row.id, status };
}
