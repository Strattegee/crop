import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, migrate, setAppRolePassword, withTenant } from '../src';

// Needs a Postgres with an owner role: set DATABASE_URL (defaults to local dev).
const OWNER_URL = process.env.DATABASE_URL ?? 'postgres://crop:crop@localhost:5432/crop';
const dbName = `crop_test_${Date.now()}`;
const ownerUrl = (db: string) => { const u = new URL(OWNER_URL); u.pathname = `/${db}`; return u.toString(); };
const appUrl = (db: string) => { const u = new URL(OWNER_URL); u.username = 'crop_app'; u.password = 'test-app-pw'; u.pathname = `/${db}`; return u.toString(); };

describe('tenant isolation', () => {
  const admin = new Client({ connectionString: OWNER_URL });
  let pool: ReturnType<typeof createPool>;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await migrate(ownerUrl(dbName), () => undefined);
    await setAppRolePassword(ownerUrl(dbName), 'test-app-pw');
    const owner = new Client({ connectionString: ownerUrl(dbName) });
    await owner.connect();
    await owner.query(`insert into tenants(id, slug, name) values ($1,'agency-a','Agency A'),($2,'agency-b','Agency B')`, [tenantA, tenantB]);
    await owner.end();
    pool = createPool(appUrl(dbName));
  });

  afterAll(async () => {
    await pool?.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  it('only shows rows for the current tenant', async () => {
    await withTenant(pool, tenantA, db => db.query(`insert into facilities(tenant_id, name) values ($1, 'Ward 3 North')`, [tenantA]));
    await withTenant(pool, tenantB, db => db.query(`insert into facilities(tenant_id, name) values ($1, 'Aged Care East')`, [tenantB]));
    const a = await withTenant(pool, tenantA, db => db.query('select name from facilities'));
    expect(a.rows.map(r => r.name)).toEqual(['Ward 3 North']);
  });

  it('refuses writes into another tenant', async () => {
    await expect(
      withTenant(pool, tenantA, db => db.query(`insert into facilities(tenant_id, name) values ($1, 'Sneaky')`, [tenantB])),
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
