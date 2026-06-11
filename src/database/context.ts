import type { Db } from './db.js';

let dbInstance: Db | undefined;

export function setDb(db: Db): void {
  dbInstance = db;
}

export function getDb(): Db {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call setDb() after bootstrap.');
  }
  return dbInstance;
}
