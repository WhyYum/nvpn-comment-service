import { Queue } from 'bullmq';
import type { Env } from '../config/env.js';

export function createRetryQueue(env: Env) {
  return new Queue('retry', { connection: { url: env.REDIS_URL } });
}

export function getRedisConnection(env: Env) {
  return { url: env.REDIS_URL };
}
