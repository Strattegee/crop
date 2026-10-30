import { Pool, PoolClient } from 'pg';

export { migrate, setAppRolePassword } from './migrate';

export function createPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString, max: 10 });
  // An idle connection dropped by the server (restart, failover) must not crash the process;
  // the pool discards it and opens a new one on the next query.
  pool.on('error', err => console.error('postgres idle connection error:', err.message));
  return pool;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who is making a change, for change logs written by triggers (e.g. the roster's shift_changes). */
export interface Actor {
  id?: string | null;
  name?: string | null;
  /** office (signed in), link (a one-off reply link), app (the person in the worker app) or system. */
  via?: 'office' | 'link' | 'app' | 'system';
  /** Their role in the business (owner, admin, allocator…), for rules such as who may change a published roster. */
  role?: string | null;
}

/**
 * Runs fn inside a transaction scoped to one tenant. Row-level security
 * policies read app.tenant_id, so queries only see and write that tenant's rows.
 * All tenant data access in the API goes through this. Pass `actor` on changes that are logged.
 */
export async function withTenant<T>(pool: Pool, tenantId: string, fn: (db: PoolClient) => Promise<T>, actor?: Actor): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('invalid tenant id');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    if (actor) {
      await client.query(
        `select set_config('app.actor_id', $1, true), set_config('app.actor_name', $2, true), set_config('app.actor_via', $3, true),
                set_config('app.actor_role', $4, true)`,
        [actor.id && UUID.test(actor.id) ? actor.id : '', (actor.name ?? '').slice(0, 120), actor.via ?? 'office', (actor.role ?? '').slice(0, 20)]);
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
