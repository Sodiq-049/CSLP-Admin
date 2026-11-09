import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { loadConfig } from '../config/env.js';
import { createApp } from '../bootstrap.js';
import { buildOpenApiDocument } from '../openapi/document.js';

/** Builds docs/openapi.json without needing a real database (docs/04 §1). */
const out = resolve(process.argv[2] ?? 'openapi.json');
const mongo = await MongoMemoryServer.create();
const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  MONGODB_URI: mongo.getUri(),
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
});
const app = await createApp(config);
await app.init();
const doc = buildOpenApiDocument(app);
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
await app.close();
await mongo.stop();
console.log(`OpenAPI written to ${out} (${Object.keys(doc.paths).length} paths)`);
