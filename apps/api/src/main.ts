import 'reflect-metadata';
import { loadConfig } from './config/env.js';
import { createApp } from './bootstrap.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.PORT);
console.log(`CSLP API listening on http://localhost:${config.PORT}/api/v1 (docs: /api/docs)`);
