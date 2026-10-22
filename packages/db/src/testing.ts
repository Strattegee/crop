// Test helper (not used at runtime): throwaway databases for integration tests.
import { Client } from 'pg';
import { migrate } from './migrate';

const SUPER_URL = process.env.DATABASE_URL ?? 'postgres://crop:crop@localhost:5432/crop';
export const APP_PASSWORD = 'test-app-pw';

function urlFor(db: string, user: string, password: string): string {
  const u = new URL(SUPER_URL);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}

/**
 * Creates a throwaway database owned by a NON-superuser role (as on DigitalOcean managed
 * Postgres), runs all migrations as that role, and enables crop_app.
 */
export async function createTestDatabase(prefix: string) {
  const name = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Client({ connectionString: SUPER_URL });
  await admin.connect();
  // Test files run in parallel, so tolerate another one creating these roles at the same moment.
  for (const sql of [
    `create role crop_owner_test login password 'owner-test-pw' createrole nosuperuser`,
    `create role crop_app nologin`,
  ]) {
    await admin.query(`do $$ begin ${sql}; exception when duplicate_object or unique_violation then null; end $$`);
  }
  await admin.query(`alter role crop_app login password '${APP_PASSWORD}'`);
  await admin.query(`create database ${name} owner crop_owner_test`);
  const ownerUrl = urlFor(name, 'crop_owner_test', 'owner-test-pw');
  await migrate(ownerUrl, () => undefined);
  return {
    ownerUrl,
    appUrl: urlFor(name, 'crop_app', APP_PASSWORD),
    async drop() {
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
