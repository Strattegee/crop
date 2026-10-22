import { Client } from 'pg';

const ROLES = ['owner', 'admin', 'allocator', 'worker', 'client'];

/**
 * Platform admin tool (runs as the database owner): creates the agency if needed and
 * invites someone by email. They get access the first time they sign in with that verified email.
 *
 *   node dist/invite-cli.js --tenant cfy --name "Caring For You" --email someone@example.com --role owner
 */
async function main() {
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) args.set(argv[i].replace(/^--/, ''), argv[i + 1]);
  const slug = args.get('tenant');
  const email = args.get('email')?.trim().toLowerCase();
  const role = args.get('role') ?? 'worker';
  if (!slug || !email || !ROLES.includes(role)) {
    throw new Error('usage: --tenant <slug> [--name "Agency name"] --email <address> --role <owner|admin|allocator|worker|client>');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('begin');
    const t = await db.query<{ id: string }>(
      `insert into tenants(slug, name) values ($1, $2)
       on conflict (slug) do update set name = coalesce($3, tenants.name) returning id`,
      [slug, args.get('name') ?? slug, args.get('name') ?? null],
    );
    const tenantId = t.rows[0].id;
    // If they've already signed in, give access straight away; otherwise leave a pending invitation.
    const u = await db.query<{ id: string }>('select id from users where email = $1', [email]);
    if (u.rows[0]) {
      await db.query(
        `insert into memberships(tenant_id, user_id, role) values ($1, $2, $3)
         on conflict (tenant_id, user_id) do update set role = excluded.role`,
        [tenantId, u.rows[0].id, role],
      );
      console.log(`${email} now has role ${role} in ${slug}`);
    } else {
      await db.query(
        `insert into invitations(tenant_id, email, role) values ($1, $2, $3)
         on conflict (tenant_id, email) where accepted_at is null do update set role = excluded.role`,
        [tenantId, email, role],
      );
      console.log(`invited ${email} to ${slug} as ${role}; access starts at their first sign-in`);
    }
    await db.query('commit');
  } catch (err) {
    await db.query('rollback');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
