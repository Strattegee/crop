import type { PoolClient } from 'pg';

/**
 * Clears away unconfirmed applications whose confirmation link has run out, with their file rows (within withTenant;
 * the database allows nothing else to be deleted). Run when a new application arrives and from the hourly reminders
 * run, so someone who never confirmed leaves nothing behind. Stored file objects stay in the store, unnamed.
 */
export async function purgeExpiredApplications(db: PoolClient): Promise<number> {
  await db.query(`delete from job_application_files f using job_applications a where a.id = f.application_id and a.status = 'pending' and a.link_expires_at < now()`);
  return (await db.query(`delete from job_applications where status = 'pending' and link_expires_at < now()`)).rowCount ?? 0;
}
