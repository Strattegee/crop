/**
 * Safety checks and clean-up for the demo-day seed. Runs as the database owner (row-level security doesn't apply),
 * so every statement names the business. Nothing here is reachable from the API.
 */
import type { ClientBase } from 'pg';

/** The only businesses the demo-day seed may ever reset (staging's Caring For You). */
export const DEMO_TENANTS: readonly string[] = ['cfy'];

export class DemoRefusal extends Error {}

/** Why the seed refuses this business, or null. */
export function tenantRefusal(slug: string): string | null {
  return DEMO_TENANTS.includes(slug) ? null : `The demo-day seed only runs for ${DEMO_TENANTS.join(', ')}, never for "${slug}"`;
}

/**
 * Why the command line refuses to run here, or null: it must be told it is on staging (`CROP_ENV=staging`, set only
 * by the staging workflow), and never points at a managed (production) database.
 */
export function environmentRefusal(env: Record<string, string | undefined>): string | null {
  if (env.CROP_ENV !== 'staging') return 'Set CROP_ENV=staging: the demo-day seed only runs on staging';
  const url = env.DATABASE_URL ?? '';
  if (!url) return 'DATABASE_URL is not set';
  let host = '';
  try { host = new URL(url).hostname; } catch { return 'DATABASE_URL is not a database address'; }
  if (/ondigitalocean\.com$|amazonaws\.com$|azure\.com$|supabase\.co$/i.test(host)) return `Refusing a managed database (${host}): staging's database runs in Docker`;
  return null;
}

/**
 * Business data the reset deletes (all rows of the business). Everything else that belongs to a business is kept
 * (KEEP), kept apart from some rows (PARTIAL), or must be empty (MUST_BE_EMPTY: links with other businesses).
 * A table in none of these lists stops the reset, so a new table always gets a decision.
 */
export const DELETE_TABLES = [
  'allocation_presence', 'areas', 'audit_log', 'availability_dates', 'availability_patterns', 'call_logs', 'client_contacts',
  'client_order_confirmations', 'client_order_notices', 'client_orders', 'clients', 'credential_documents', 'credential_events',
  'dashboard_snapshots', 'day_requests', 'employment_terms', 'equipment', 'equipment_checks', 'equipment_site_allocations', 'facilities', 'leave_records',
  'member_offices', 'member_sites', 'notifications', 'offices', 'onboarding_ticks', 'outside_agency_emails', 'recruitment_events', 'reminder_marks',
  'right_to_work_events', 'right_to_work_records', 'roster_change_requests', 'roster_publications', 'roster_template_duties',
  'roster_template_equipment', 'roster_template_shifts', 'roster_templates', 'shift_assignments', 'shift_changes', 'shift_duty_links',
  'shift_offers', 'shift_swaps', 'shifts', 'site_members', 'stock_movements', 'upload_links', 'worker_addresses', 'worker_credentials', 'worker_notice_acknowledgements',
  'worker_onboardings', 'workers',
];
/** Kept, apart from the rows matched here ($1 = the business, $2 = the demo officers' user ids). */
export const PARTIAL: Record<string, string> = {
  shift_codes: 'facility_id is not null',
  site_cover_rules: 'facility_id is not null',
  memberships: 'user_id = any($2::uuid[])',
  member_focus: 'user_id = any($2::uuid[])',
};
/** Set-up and sign-ins: kept as they are. */
export const KEEP_TABLES = [
  'tenant_settings', 'field_access', 'invitations', 'business_terms', 'industry_pack_applications', 'credential_types', 'credential_requirements',
  'business_roles', 'shift_duties', 'shift_duty_requirements', 'equipment_types', 'items', 'onboarding_checklists', 'onboarding_steps',
  'dashboard_targets', 'outside_agencies', 'push_devices', 'platform_admin_events', 'agency_connections', 'agency_credential_maps',
  'agency_invitations', 'agency_events',
];
/** Work shared with another business: the reset stops rather than leave the other side pointing at nothing. */
export const MUST_BE_EMPTY = ['agency_requests', 'agency_request_rounds', 'agency_inbox', 'agency_offers', 'agency_placements'];
/** Kept tables that point at deleted rows, and how the reset lets go of them first. */
const LET_GO: Record<string, string> = {
  'invitations->workers': 'update invitations set worker_id = null where tenant_id = $1 and worker_id is not null',
};

export interface Edge { child: string; parent: string }

/** Deletion order: a table before anything it points at (self-references ignored). Throws on a cycle. */
export function deleteOrder(tables: string[], edges: Edge[]): string[] {
  const set = new Set(tables);
  const pointsAt = new Map(tables.map(t => [t, new Set<string>()]));
  for (const e of edges) if (set.has(e.child) && set.has(e.parent) && e.child !== e.parent) pointsAt.get(e.child)!.add(e.parent);
  // A table can go once nothing still to delete points at it.
  const out: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter(t => ![...left].some(o => o !== t && pointsAt.get(o)!.has(t))).sort();
    if (!ready.length) throw new Error(`Can't order the clean-up: ${[...left].join(', ')} point at each other`);
    for (const t of ready) { out.push(t); left.delete(t); }
  }
  return out;
}

async function tenantTables(db: ClientBase): Promise<string[]> {
  return (await db.query<{ t: string }>(
    `select c.table_name as t from information_schema.columns c join information_schema.tables x using (table_schema, table_name)
      where c.table_schema = 'public' and c.column_name = 'tenant_id' and x.table_type = 'BASE TABLE' order by 1`)).rows.map(r => r.t);
}

async function foreignKeys(db: ClientBase): Promise<Edge[]> {
  return (await db.query<Edge>(
    `select conrelid::regclass::text as child, confrelid::regclass::text as parent from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace`)).rows;
}

const EXAMPLE_DOMAIN = `'^(example\\.(com|org|net)|.+\\.(example|test|invalid|localhost))$'`;
const realEmail = (col: string) => `(${col} is not null and trim(${col}) <> '' and split_part(lower(${col}), '@', 2) !~ ${EXAMPLE_DOMAIN})`;
const hasPhone = (col: string) => `(${col} is not null and trim(${col}) <> '')`;

/**
 * Anything in the business that doesn't look invented: an email that isn't at a reserved example domain, or any phone
 * number, on people, clients, contacts, orders and sites. Returns one line per kind found (with a few initials to
 * recognise them by), empty when everything looks like demo data.
 */
export async function realLookingData(db: ClientBase, tenantId: string): Promise<string[]> {
  const checks: [string, string, string][] = [
    ['people', 'workers', `${realEmail('email')} or ${hasPhone('phone')}`],
    ['client contacts', 'client_contacts', `${realEmail('email')} or ${hasPhone('phone')}`],
    ['clients', 'clients', `${realEmail('billing_email')} or ${hasPhone('phone')}`],
    ['client orders', 'client_orders', `${realEmail('requested_by_email')} or ${hasPhone('requested_by_phone')}`],
    ['sites', 'facilities', hasPhone('phone')],
  ];
  const out: string[] = [];
  for (const [label, table, where] of checks) {
    const nameCol = table === 'workers' ? `first_name || ' ' || left(last_name, 1) || '.'` : table === 'client_orders' ? `left(requested_by_name, 1) || '.'` : `left(name, 1) || '.'`;
    const r = (await db.query<{ n: number; sample: string[] }>(
      `select count(*)::int as n, (array_agg(${nameCol} order by created_at))[1:5] as sample from ${table} where tenant_id = $1 and (${where})`, [tenantId])).rows[0];
    if (r.n) out.push(`${r.n} ${label} with a real-looking email or a phone number (e.g. ${r.sample.join(', ')})`);
  }
  return out;
}

export interface CleanupPlan { order: string[]; partial: string[]; counts: Record<string, number> }

/** Works out what the reset would delete, refusing (DemoRefusal) when anything would be unsafe. */
export async function planCleanup(db: ClientBase, tenantId: string, demoUserIds: string[]): Promise<CleanupPlan> {
  const tables = await tenantTables(db);
  const known = new Set([...DELETE_TABLES, ...Object.keys(PARTIAL), ...KEEP_TABLES, ...MUST_BE_EMPTY]);
  const unknown = tables.filter(t => !known.has(t));
  if (unknown.length) throw new DemoRefusal(`The demo-day reset doesn't know these tables yet: ${unknown.join(', ')}. Add each to a list in demo-cleanup.ts.`);
  for (const t of MUST_BE_EMPTY) {
    const n = (await db.query<{ n: number }>(`select count(*)::int as n from ${t} where tenant_id = $1`, [tenantId])).rows[0].n;
    if (n) throw new DemoRefusal(`This business has agency work with another business (${t}: ${n}); end that first`);
  }
  const edges = await foreignKeys(db);
  const deleting = new Set([...DELETE_TABLES, ...Object.keys(PARTIAL)]);
  for (const e of edges) {
    if (KEEP_TABLES.includes(e.child) && deleting.has(e.parent) && !LET_GO[`${e.child}->${e.parent}`] && !(e.parent in PARTIAL)) {
      throw new DemoRefusal(`Kept table ${e.child} points at ${e.parent}, which the reset deletes; add how to let go of it in demo-cleanup.ts`);
    }
  }
  const order = deleteOrder([...deleting].filter(t => tables.includes(t)), edges);
  const counts: Record<string, number> = {};
  for (const t of order) {
    const where = PARTIAL[t] ? `tenant_id = $1 and ${PARTIAL[t]}` : 'tenant_id = $1';
    const params = PARTIAL[t]?.includes('$2') ? [tenantId, demoUserIds] : [tenantId];
    counts[t] = (await db.query<{ n: number }>(`select count(*)::int as n from ${t} where ${where}`, params)).rows[0].n;
  }
  return { order, partial: Object.keys(PARTIAL), counts };
}

/** Deletes the business's data in the planned order (inside the caller's transaction, triggers already off). */
export async function runCleanup(db: ClientBase, tenantId: string, demoUserIds: string[], plan: CleanupPlan): Promise<number> {
  for (const sql of Object.values(LET_GO)) await db.query(sql, [tenantId]);
  let n = 0;
  for (const t of plan.order) {
    const where = PARTIAL[t] ? `tenant_id = $1 and ${PARTIAL[t]}` : 'tenant_id = $1';
    const params = PARTIAL[t]?.includes('$2') ? [tenantId, demoUserIds] : [tenantId];
    n += (await db.query(`delete from ${t} where ${where}`, params)).rowCount ?? 0;
  }
  return n;
}

/** Tables with triggers of their own (audit, change logs, agency follow-ups): switched off while the seed writes. */
export async function triggerTables(db: ClientBase): Promise<string[]> {
  return (await db.query<{ t: string }>(
    `select distinct c.relname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid
      where not g.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1`)).rows.map(r => r.t);
}
