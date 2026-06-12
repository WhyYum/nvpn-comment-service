import { z } from 'zod';
import type { ProxyInterface } from 'telegram/network/connection/TCPMTProxy.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  ADMIN_IDS: z.string().min(1, 'ADMIN_IDS is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),

  TELEGRAM_PROXY_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
  TELEGRAM_PROXY_HOST: z.string().optional(),
  TELEGRAM_PROXY_PORT: z.coerce.number().optional(),
  TELEGRAM_PROXY_TYPE: z.enum(['socks5', 'socks4']).default('socks5'),
  TELEGRAM_PROXY_USERNAME: z.string().optional(),
  TELEGRAM_PROXY_PASSWORD: z.string().optional(),

  AUTH_DEBUG: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${messages}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function getAdminIds(env: Env): number[] {
  return env.ADMIN_IDS.split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
}

export function getTelegramProxy(env: Env): ProxyInterface | undefined {
  if (!env.TELEGRAM_PROXY_ENABLED) return undefined;

  const host = env.TELEGRAM_PROXY_HOST?.trim();
  const port = env.TELEGRAM_PROXY_PORT;

  if (!host || !port || isNaN(port)) {
    throw new Error(
      'TELEGRAM_PROXY_ENABLED=true but TELEGRAM_PROXY_HOST or TELEGRAM_PROXY_PORT is missing',
    );
  }

  const proxy: ProxyInterface = {
    ip: host,
    port,
    socksType: env.TELEGRAM_PROXY_TYPE === 'socks4' ? 4 : 5,
  };

  if (env.TELEGRAM_PROXY_USERNAME) {
    (proxy as { username?: string }).username = env.TELEGRAM_PROXY_USERNAME;
  }
  if (env.TELEGRAM_PROXY_PASSWORD) {
    (proxy as { password?: string }).password = env.TELEGRAM_PROXY_PASSWORD;
  }

  return proxy;
}
