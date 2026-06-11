import { getDb } from '../database/context.js';
import { logEntries } from '../database/schema/index.js';
import { newId } from '../database/id.js';
import { LogLevel, type LogLevel as LogLevelType } from '../database/types.js';
import { logger } from '../core/logger.js';

export interface LogOptions {
  level: LogLevelType;
  eventType: string;
  message: string;
  accountId?: string;
  meta?: Record<string, unknown>;
}

export async function writeLog(opts: LogOptions): Promise<void> {
  const { level, eventType, message, accountId, meta } = opts;

  const pinoLevel =
    level === LogLevel.ERROR ? 'error' : level === LogLevel.WARN ? 'warn' : 'info';
  logger[pinoLevel]({ eventType, accountId, ...sanitizeMeta(meta) }, message);

  try {
    const sanitized = meta ? sanitizeMeta(meta) : undefined;
    await getDb().insert(logEntries).values({
      id: newId(),
      level,
      eventType,
      message,
      accountId: accountId ?? null,
      meta: sanitized ?? null,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to write log to DB');
  }
}

function sanitizeMeta(
  meta?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const sensitive = new Set([
    'apiHash',
    'sessionString',
    'password',
    'code',
    'encryptionKey',
    'ENCRYPTION_KEY',
    'apiHashEncrypted',
    'sessionEncrypted',
  ]);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    result[k] = sensitive.has(k) ? '[REDACTED]' : v;
  }
  return result;
}
