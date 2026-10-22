import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, withTenant } from '../src';
import { createTestDatabase } from '../src/testing';

describe('users, memberships and invitations', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: ReturnType<typeof createPool>;
  let owner: Client;
  const cfy = randomUUID();
  const other = randomUUID();

  beforeAll(async () => {
    db = await createTestDatabase('crop_users');
    owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    await owner.query(`insert into tenants(id, slug, name) values ($1,'cfy','Demo Agency'),($2,'other','Other Agency')`, [cfy, other]);
    await owner.query(`insert into invitations(tenant_id, email, role) values ($1,'jo@example.com','allocator'),($2,'jo@example.com','worker')`, [cfy, other]);
    pool = createPool(db.appUrl);
  });

  afterAll(async () => {
    await owner?.end();
    await pool?.end();
    await db?.drop();
  });

  const signIn = (sub: string, email: string, verified: boolean, name: string | null = null) =>
    pool.query('select * from app_sign_in($1, $2, $3, $4)', [sub, email, verified, name]).then(r => r.rows[0]);
  const memberships = (userId: string) =>
    pool.query('select tenant_slug, role from app_user_memberships($1)', [userId]).then(r => r.rows);

  it('does not accept invitations for an unverified email', async () => {
    const u = await signIn('sub-unverified', 'Jo@Example.com', false);
    expect(u.email).toBe('jo@example.com');
    expect(await memberships(u.id)).toEqual([]);
  });

  it('accepts all pending invitations once the email is verified', async () => {
    const u = await signIn('sub-jo', 'jo@example.com', true, 'Jo Citizen');
    expect(await memberships(u.id)).toEqual([
      { tenant_slug: 'cfy', role: 'allocator' },
      { tenant_slug: 'other', role: 'worker' },
    ]);
    const pending = await owner.query('select count(*)::int as n from invitations where accepted_at is null');
    expect(pending.rows[0].n).toBe(0);
  });

  it('signing in again updates the user, not duplicates them', async () => {
    const a = await signIn('sub-jo', 'jo@example.com', true);
    const b = await pool.query('select * from app_user_by_subject($1)', ['sub-jo']);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ id: a.id, display_name: 'Jo Citizen' });
  });

  it('keeps crop_app out of the users table', async () => {
    await expect(pool.query('select * from users')).rejects.toThrow(/permission denied/);
  });

  it('only shows memberships and invitations of the current agency', async () => {
    const rows = await withTenant(pool, cfy, c => c.query('select role from memberships'));
    expect(rows.rows).toEqual([{ role: 'allocator' }]);
    const inv = await withTenant(pool, other, c => c.query('select email from invitations'));
    expect(inv.rows).toEqual([{ email: 'jo@example.com' }]);
  });
});
