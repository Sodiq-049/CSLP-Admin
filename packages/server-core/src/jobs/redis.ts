import { Redis } from 'ioredis';

/**
 * BullMQ 6 treats ioredis as an optional peer and, under native ESM, needs a constructed client
 * instead of connection options. `maxRetriesPerRequest: null` is required for blocking workers.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}
