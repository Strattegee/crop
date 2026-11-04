import { AsyncLocalStorage } from 'node:async_hooks';
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
 * Who the current request is for, for the audit log (migration 0055). The API starts a store per request and the
 * sign-in guard fills `actor`; withTenant then tells the database (`app.audit_*`) without changing the rules that
 * read `app.actor_*` (only an explicit `actor` sets those). Background jobs have no store: the log says "system".
 */
export const auditStore = new AsyncLocalStorage<{ actor?: Actor; scope?: SiteScope }>();

/**
 * The signed-in person's access in one business (migration 0086), set by the sign-in guard: `sites` null = every site;
 * otherwise only those (maybe none). withTenant tells the database (`app.site_scope`, `app.member_role`) when it runs
 * for that business, and the restrictive policies do the rest. Background jobs have no store: every site.
 */
export interface SiteScope {
  tenantId: string;
  role: string;
  sites: string[] | null;
}

/** The setting's value for a list of sites ('' = every site). */
export function siteScopeValue(sites: string[] | null): string {
  if (sites === null) return '';
  const ok = sites.filter(s => UUID.test(s));
  return `{${ok.join(',')}}`;
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
    const store = auditStore.getStore();
    const scope = store?.scope;
    if (scope && scope.tenantId === tenantId) {
      await client.query(`select set_config('app.site_scope', $1, true), set_config('app.member_role', $2, true)`,
        [siteScopeValue(scope.sites), scope.role.slice(0, 20)]);
    }
    const who = actor ?? store?.actor;
    if (who) {
      await client.query(`select set_config('app.audit_id', $1, true), set_config('app.audit_name', $2, true), set_config('app.audit_via', $3, true)`,
        [who.id && UUID.test(who.id) ? who.id : '', (who.name ?? '').slice(0, 120), who.via ?? 'office']);
    }
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

/**
 * Runs fn with every site in view and no supervisor limits (inside withTenant), then puts the person's limits back. Only for work that must
 * see the whole business to be right and gives back verdicts or totals, never another site's rows: eligibility's
 * clashes, rest and visa hours across sites, equipment bookings and allocations elsewhere, hours rostered, and the
 * business-wide numbers (Dashboard, Live numbers; David, 4 Nov, answer 3).
 */
export async function acrossSites<T>(db: PoolClient, fn: () => Promise<T>): Promise<T> {
  const prev = (await db.query<{ s: string | null; r: string | null }>(
    `select current_setting('app.site_scope', true) as s, current_setting('app.member_role', true) as r`)).rows[0];
  const sites = prev?.s ?? '';
  const role = prev?.r ?? '';
  if (!sites && !role) return fn();
  await db.query(`select set_config('app.site_scope', '', true), set_config('app.member_role', '', true)`);
  try {
    return await fn();
  } finally {
    // After an error the transaction is aborted and rolls back anyway (a savepoint rollback restores the settings).
    await db.query(`select set_config('app.site_scope', $1, true), set_config('app.member_role', $2, true)`, [sites, role]).catch(() => undefined);
  }
}
