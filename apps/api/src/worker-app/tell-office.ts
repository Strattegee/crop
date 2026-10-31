import type { PoolClient } from 'pg';
import { queueNotification } from '../notifications/notify.js';

/**
 * Emails the business's owners and admins about something that arrived from the worker app (a leave request, a
 * credential to check), inside the same transaction, once per address. Not the person themselves if they are also
 * an owner or admin.
 */
export async function tellOffice(
  db: PoolClient, tenantId: string,
  m: { subject: string; body: string; template: string; dedupeKey: string; createdBy: string | null; exceptEmail?: string | null },
): Promise<number> {
  const except = (m.exceptEmail ?? '').trim().toLowerCase();
  let n = 0;
  for (const o of (await db.query<{ email: string }>('select email from app_agency_office_emails()')).rows) {
    const to = (o.email ?? '').trim().toLowerCase();
    if (!to || to === except) continue;
    await queueNotification(db, tenantId, {
      channel: 'email', to: o.email, template: m.template, subject: m.subject, body: m.body,
      createdBy: m.createdBy, dedupeKey: `${m.dedupeKey}:${to}`,
    });
    n++;
  }
  return n;
}
