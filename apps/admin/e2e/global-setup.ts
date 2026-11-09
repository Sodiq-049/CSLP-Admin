import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mongoUri, SUPER_ADMIN } from './env';

/** Seed the throwaway database with a super admin (and the YABATECH shell) using the real seed script. */
export default async function globalSetup() {
  const seed = fileURLToPath(new URL('../../api/dist/scripts/seed.js', import.meta.url));
  execFileSync(process.execPath, [seed], {
    env: {
      ...process.env,
      MONGODB_URI: mongoUri(),
      SEED_SUPER_ADMIN_EMAIL: SUPER_ADMIN.email,
      SEED_SUPER_ADMIN_PASSWORD: SUPER_ADMIN.password,
    },
    stdio: 'inherit',
  });
}
