import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, withTenant } from '../src';
import { createTestDatabase } from '../src/testing';

describe('workers and credentials tables', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: ReturnType<typeof createPool>;
  const a = randomUUID();
  const b = randomUUID();

  beforeAll(async () => {
    db = await createTestDatabase('crop_workers');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    await owner.query(`insert into tenants(id, slug, name) values ($1,'agency-a','A'),($2,'agency-b','B')`, [a, b]);
    await owner.end();
    pool = createPool(db.appUrl);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it('keeps every new table separate per agency', async () => {
    for (const t of [a, b]) {
      await withTenant(pool, t, async c => {
        const w = await c.query(`insert into workers(tenant_id, first_name, last_name) values ($1,'Jo','Citizen') returning id`, [t]);
        const ct = await c.query(`insert into credential_types(tenant_id, name, category) values ($1,'Police check','check') returning id`, [t]);
        await c.query(`insert into credential_requirements(tenant_id, credential_type_id, scope) values ($1,$2,'all_workers')`, [t, ct.rows[0].id]);
        const wc = await c.query(
          `insert into worker_credentials(tenant_id, worker_id, credential_type_id, expiry_date) values ($1,$2,$3,'2027-01-01') returning id`,
          [t, w.rows[0].id, ct.rows[0].id],
        );
        await c.query(`insert into credential_events(tenant_id, worker_credential_id, action) values ($1,$2,'created')`, [t, wc.rows[0].id]);
        await c.query(`insert into tenant_settings(tenant_id) values ($1)`, [t]);
      });
    }
    for (const table of ['workers', 'credential_types', 'credential_requirements', 'worker_credentials', 'credential_events', 'tenant_settings']) {
      const r = await withTenant(pool, a, c => c.query(`select tenant_id from ${table}`));
      expect(r.rows.length, table).toBe(1);
      expect(r.rows[0].tenant_id, table).toBe(a);
    }
  });

  it('refuses to put rows in another agency', async () => {
    await expect(
      withTenant(pool, a, c => c.query(`insert into workers(tenant_id, first_name, last_name) values ($1,'X','Y')`, [b])),
    ).rejects.toThrow(/row-level security/);
  });

  it('does not let the API rewrite credential history', async () => {
    await expect(withTenant(pool, a, c => c.query(`update credential_events set action = 'verified'`))).rejects.toThrow(/permission denied/);
    await expect(withTenant(pool, a, c => c.query(`delete from credential_events`))).rejects.toThrow(/permission denied/);
  });

  it('rejects a credential type name used twice in one agency, ignoring case', async () => {
    await expect(
      withTenant(pool, a, c => c.query(`insert into credential_types(tenant_id, name, category) values ($1,'POLICE CHECK','check')`, [a])),
    ).rejects.toThrow(/duplicate key/);
  });
});
