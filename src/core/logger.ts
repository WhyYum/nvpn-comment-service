import pino from 'pino';
import type { Env } from '../config/env.js';

export function createLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    redact: {
      paths: [
        'apiHash',
        'sessionString',
        'password',
        'code',
        'encryptionKey',
        'ENCRYPTION_KEY',
        '*.apiHash',
        '*.sessionString',
        '*.password',
        '*.code',
      ],
      censor: '[REDACTED]',
    },
  });
}

let _logger: pino.Logger | null = null;

export function initLogger(env: Env): pino.Logger {
  _logger = createLogger(env);
  return _logger;
}

function getLogger(): pino.Logger {
  if (!_logger) {
    throw new Error('Logger not initialized. Call initLogger first.');
  }
  return _logger;
}

export const logger = {
  trace: (...args: Parameters<pino.Logger['trace']>) => getLogger().trace(...args),
  debug: (...args: Parameters<pino.Logger['debug']>) => getLogger().debug(...args),
  info: (...args: Parameters<pino.Logger['info']>) => getLogger().info(...args),
  warn: (...args: Parameters<pino.Logger['warn']>) => getLogger().warn(...args),
  error: (...args: Parameters<pino.Logger['error']>) => getLogger().error(...args),
};
