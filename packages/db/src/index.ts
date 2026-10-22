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

/**
 * Runs fn inside a transaction scoped to one tenant. Row-level security
 * policies read app.tenant_id, so queries only see and write that tenant's rows.
 * All tenant data access in the API goes through this.
 */
export async function withTenant<T>(pool: Pool, tenantId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('invalid tenant id');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
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
