import { createRequire } from 'node:module';
import { mongoUri } from './env';

/** Drop the throwaway database (mongoose is borrowed from the API workspace). */
export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DB) return;
  const require = createRequire(new URL('../../api/package.json', import.meta.url));
  const mongoose = require('mongoose') as {
    connect(uri: string): Promise<unknown>;
    connection: { dropDatabase(): Promise<unknown> };
    disconnect(): Promise<void>;
  };
  await mongoose.connect(mongoUri());
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
