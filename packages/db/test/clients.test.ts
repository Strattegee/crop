import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, withTenant } from '../src';
import { createTestDatabase } from '../src/testing';

describe('clients and areas tables', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: ReturnType<typeof createPool>;
  const a = randomUUID();
  const b = randomUUID();

  beforeAll(async () => {
    db = await createTestDatabase('crop_clients');
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

  it('keeps clients and areas separate per agency', async () => {
    for (const t of [a, b]) {
      await withTenant(pool, t, async c => {
        const cl = await c.query(`insert into clients(tenant_id, name) values ($1,'Northside Health') returning id`, [t]);
        const f = await c.query(`insert into facilities(tenant_id, client_id, name, state) values ($1,$2,'Northside Hospital','VIC') returning id`, [t, cl.rows[0].id]);
        await c.query(`insert into areas(tenant_id, facility_id, name, specialty) values ($1,$2,'Ward 3','Aged Care')`, [t, f.rows[0].id]);
      });
    }
    for (const table of ['clients', 'areas']) {
      const r = await withTenant(pool, a, c => c.query(`select tenant_id from ${table}`));
      expect(r.rows.map(x => x.tenant_id), table).toEqual([a]);
    }
  });

  it("refuses to link a facility to another agency's client", async () => {
    const bClient = await withTenant(pool, b, c => c.query(`select id from clients`));
    await expect(
      withTenant(pool, a, c => c.query(`insert into facilities(tenant_id, client_id, name) values ($1,$2,'X')`, [a, bClient.rows[0].id])),
    ).rejects.toThrow(/another agency|violates foreign key/);
  });

  it('checks ABN, state and postcode formats', async () => {
    await expect(withTenant(pool, a, c => c.query(`insert into clients(tenant_id, name, abn) values ($1,'Bad ABN','123')`, [a]))).rejects.toThrow(/check/);
    await expect(withTenant(pool, a, c => c.query(`insert into facilities(tenant_id, name, state) values ($1,'X','Victoria')`, [a]))).rejects.toThrow(/check/);
  });
});
