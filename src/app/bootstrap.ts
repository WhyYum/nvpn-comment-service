import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { initLogger } from '../core/logger.js';
import { bootstrapSchema } from '../database/bootstrap-schema.js';
import { createDb } from '../database/db.js';
import { setDb } from '../database/context.js';
import { ensureDefaultLimitsExist } from '../services/limits.service.js';
import { ensureDefaultParserSettingsExist } from '../services/parser-settings.service.js';
import { ensureDefaultStatusSettingsExist } from '../services/status-settings.service.js';
import type { Env } from '../config/env.js';

export async function bootstrapApp(): Promise<Env> {
  const env = loadEnv();
  initLogger(env);
  await bootstrapSchema(env);
  setDb(createDb(env));
  await ensureDefaultLimitsExist();
  await ensureDefaultParserSettingsExist();
  await ensureDefaultStatusSettingsExist();
  return env;
}
