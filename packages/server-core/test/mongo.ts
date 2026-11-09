import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/** Single-node replica set so transactions work, mirroring Atlas. */
export async function startMongo(): Promise<{ uri: string; stop: () => Promise<void> }> {
  const repl = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = repl.getUri();
  return {
    uri,
    stop: async () => {
      await mongoose.disconnect();
      await repl.stop();
    },
  };
}
