import { migrate, setAppRolePassword } from './migrate';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const applied = await migrate(url);
  if (applied.length === 0) console.log('database is up to date');
  const appPassword = process.env.APP_DB_PASSWORD;
  if (appPassword) {
    await setAppRolePassword(url, appPassword);
    console.log('crop_app login enabled');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
