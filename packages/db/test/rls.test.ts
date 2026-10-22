import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, withTenant } from '../src';
import { createTestDatabase } from '../src/testing';

describe('tenant isolation', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: ReturnType<typeof createPool>;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    db = await createTestDatabase('crop_rls');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    await owner.query(`insert into tenants(id, slug, name) values ($1,'agency-a','Agency A'),($2,'agency-b','Agency B')`, [tenantA, tenantB]);
    await owner.end();
    pool = createPool(db.appUrl);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it('only shows rows for the current tenant', async () => {
    await withTenant(pool, tenantA, c => c.query(`insert into facilities(tenant_id, name) values ($1, 'Ward 3 North')`, [tenantA]));
    await withTenant(pool, tenantB, c => c.query(`insert into facilities(tenant_id, name) values ($1, 'Aged Care East')`, [tenantB]));
    const a = await withTenant(pool, tenantA, c => c.query('select name from facilities'));
    expect(a.rows.map(r => r.name)).toEqual(['Ward 3 North']);
  });

  it('refuses writes into another tenant', async () => {
    await expect(
      withTenant(pool, tenantA, c => c.query(`insert into facilities(tenant_id, name) values ($1, 'Sneaky')`, [tenantB])),
    ).rejects.toThrow(/row-level security/);
  });

  it('shows nothing when no tenant is set', async () => {
    const c = await pool.connect();
    try {
      const r = await c.query('select count(*)::int as n from facilities');
      expect(r.rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });
});
