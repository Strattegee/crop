import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

/**
 * Applies pending .sql files in name order, each in its own transaction.
 * Connect as the database owner, never as crop_app.
 */
export async function migrate(databaseUrl: string, log: (m: string) => void = console.log): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map(r => r.name));
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query('begin');
      try {
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        await client.query('insert into schema_migrations(name) values ($1)', [file]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      log(`applied ${file}`);
      applied.push(file);
    }
    return applied;
  } finally {
    await client.end();
  }
}

/** Lets crop_app log in with the given password (run after migrations). */
export async function setAppRolePassword(databaseUrl: string, password: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ q: string }>('select quote_literal($1) as q', [password]);
    await client.query(`alter role crop_app login password ${rows[0].q}`);
  } finally {
    await client.end();
  }
}
