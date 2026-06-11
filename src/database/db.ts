import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import type { Env } from '../config/env.js';

export function createDb(env: Env) {
  const client = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
