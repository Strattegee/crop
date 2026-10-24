import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, withTenant } from '../src';
import { createTestDatabase } from '../src/testing';

describe('notification queue', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: ReturnType<typeof createPool>;
  const a = randomUUID();
  const b = randomUUID();

  beforeAll(async () => {
    db = await createTestDatabase('crop_notify');
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    await owner.query(`insert into tenants(id, slug, name) values ($1,'agency-a','A'),($2,'agency-b','B')`, [a, b]);
    await owner.end();
    pool = createPool(db.appUrl);
    for (const t of [a, b]) {
      await withTenant(pool, t, c => c.query(`insert into notifications(tenant_id, channel, to_address, template, body) values ($1,'email','x@example.com','test','hi')`, [t]));
    }
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it('keeps each agency’s log separate', async () => {
    expect((await withTenant(pool, a, c => c.query('select tenant_id from notifications'))).rows).toEqual([{ tenant_id: a }]);
  });

  it('lets the sender claim messages from every agency once, then finish or retry them', async () => {
    const claimed = (await pool.query('select * from app_claim_notifications(10)')).rows;
    expect(claimed.map(r => r.tenant_id).sort()).toEqual([a, b].sort());
    expect((await pool.query('select * from app_claim_notifications(10)')).rows).toEqual([]); // nothing left to claim
    await pool.query('select app_finish_notification($1, true, $2, null, null)', [claimed[0].id, 'prov-1']);
    await pool.query('select app_finish_notification($1, false, null, $2, 60)', [claimed[1].id, 'timeout']);
    const rows = (await withTenant(pool, claimed[1].tenant_id, c => c.query('select status, attempts, last_error from notifications'))).rows;
    expect(rows).toEqual([{ status: 'queued', attempts: 1, last_error: 'timeout' }]);
    const sent = (await withTenant(pool, claimed[0].tenant_id, c => c.query('select status, provider_message_id from notifications'))).rows;
    expect(sent).toEqual([{ status: 'sent', provider_message_id: 'prov-1' }]);
  });

  it('refuses the same reminder twice', async () => {
    const q = () => withTenant(pool, a, c => c.query(`insert into notifications(tenant_id, channel, to_address, template, dedupe_key, body) values ($1,'sms','+61400000000','x','k1','hi')`, [a]));
    await q();
    await expect(q()).rejects.toThrow(/duplicate key/);
  });
});
