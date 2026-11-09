import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real stack: the built API + built admin app, using the local
 * Docker MongoDB (pnpm infra:up) with a throwaway database per run.
 */
process.env.E2E_DB ??= `cslp_e2e_${Date.now()}`;
const MONGO = process.env.E2E_MONGO_URL ?? 'mongodb://localhost:27018';
export const E2E_MONGODB_URI = `${MONGO}/${process.env.E2E_DB}?directConnection=true`;
const API_PORT = 4100;
const ADMIN_PORT = 3101;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${ADMIN_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --enable-source-maps ../api/dist/main.js',
      url: `http://localhost:${API_PORT}/api/v1/public/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        PORT: String(API_PORT),
        MONGODB_URI: E2E_MONGODB_URI,
        JWT_ACCESS_SECRET: 'e2e-secret-'.padEnd(48, 'x'),
        MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
        ADMIN_APP_URL: `http://localhost:${ADMIN_PORT}`,
        AI_TEXT_PROVIDER: 'fake',
      },
    },
    {
      command: `NEXT_DIST_DIR=.next-e2e pnpm exec next start --port ${ADMIN_PORT}`,
      url: `http://localhost:${ADMIN_PORT}/login`,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}`, NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
