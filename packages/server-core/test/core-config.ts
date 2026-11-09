import type { CoreConfig } from '../src/config.js';

export const TEST_CORE_CONFIG: CoreConfig = {
  storage: { driver: 'memory' },
  queue: { mode: 'inline' },
  scanner: { driver: 'none' },
  ai: {
    textProvider: 'fake',
    textModels: {},
    embeddings: { provider: 'fake', model: 'fake-hash-v1', dimensions: 64 },
    // Test-only price so cost/budget logic can be exercised; real prices come from AI_PRICES_JSON.
    prices: { 'fake-placeholder-v1': { input: 1000, output: 2000 } },
  },
};
