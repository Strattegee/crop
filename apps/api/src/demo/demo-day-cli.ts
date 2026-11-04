/**
 * Resets the staging business Caring For You (`cfy`) to an invented, realistic agency day for demos (David, 3 Nov 2026).
 * Runs as the database owner, like the migrations. Without `--confirm RESET` it only reports what it would delete.
 *
 *   CROP_ENV=staging node dist/demo/demo-day-cli.js --tenant cfy [--day YYYY-MM-DD] [--delete-real-looking] --confirm RESET
 *
 * Safety: only on staging (CROP_ENV=staging, never a managed database), only for the businesses in DEMO_TENANTS,
 * and never when the business holds anything that looks real (an email that isn't at example.com, or any phone number),
 * unless `--delete-real-looking` says those records are test entries to delete too (real sign-ins are always kept).
 */
import { Client } from 'pg';
import { environmentRefusal } from './demo-cleanup.js';
import { DemoRefusal, demoDay } from './demo-day.js';

/** Flags that take no value. */
const FLAGS = ['delete-real-looking'];

/** Reads --name value pairs and the flags (set to 'yes'); unknown names refused. */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length;) {
    const k = argv[i]?.replace(/^--/, '') ?? '';
    if (FLAGS.includes(k)) { out[k] = 'yes'; i += 1; continue; }
    if (!['tenant', 'day', 'confirm'].includes(k)) throw new DemoRefusal(`Unknown option ${argv[i]}; use --tenant, --day, --confirm and --delete-real-looking`);
    out[k] = argv[i + 1] ?? '';
    i += 2;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = environmentRefusal(process.env);
  if (env) throw new DemoRefusal(env);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const started = Date.now();
    const r = await demoDay(db, { slug: args.tenant ?? 'cfy', day: args.day || undefined, confirm: args.confirm, deleteRealLooking: args['delete-real-looking'] === 'yes', log: line => console.log(line) });
    console.log(r.dryRun ? 'Dry run finished: nothing changed.' : `Demo day ${r.day} ready in ${Math.round((Date.now() - started) / 1000)} s.`);
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error(err instanceof DemoRefusal ? `Refused: ${err.message}` : err);
  process.exit(1);
});
