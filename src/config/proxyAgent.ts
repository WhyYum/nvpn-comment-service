import type { Agent } from 'http';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ApiClientOptions } from 'grammy';
import type { Env } from './env.js';
import { getTelegramProxy } from './env.js';
import { logger } from '../core/logger.js';

const agentCache = new Map<string, Agent | undefined>();
const clientOptionsCache = new Map<string, ApiClientOptions | undefined>();

export function getBotApiProxyAgent(env: Env): Agent | undefined {
  const cacheKey = env.TELEGRAM_PROXY_ENABLED ? 'proxy' : 'none';
  if (agentCache.has(cacheKey)) {
    return agentCache.get(cacheKey);
  }

  if (!env.TELEGRAM_PROXY_ENABLED) {
    agentCache.set(cacheKey, undefined);
    return undefined;
  }

  const host = env.TELEGRAM_PROXY_HOST?.trim();
  const port = env.TELEGRAM_PROXY_PORT;

  if (!host || !port || isNaN(port)) {
    throw new Error(
      'TELEGRAM_PROXY_ENABLED=true but TELEGRAM_PROXY_HOST or TELEGRAM_PROXY_PORT is missing',
    );
  }

  const protocol = env.TELEGRAM_PROXY_TYPE === 'socks4' ? 'socks4' : 'socks5';
  let url = `${protocol}://`;

  if (env.TELEGRAM_PROXY_USERNAME) {
    const user = encodeURIComponent(env.TELEGRAM_PROXY_USERNAME);
    const pass = env.TELEGRAM_PROXY_PASSWORD
      ? `:${encodeURIComponent(env.TELEGRAM_PROXY_PASSWORD)}`
      : '';
    url += `${user}${pass}@`;
  }

  url += `${host}:${port}`;

  logger.info({ host, port, type: protocol }, 'grammY Bot API will use SOCKS proxy');

  const agent = new SocksProxyAgent(url);
  agentCache.set(cacheKey, agent);
  return agent;
}

export function getGrammyClientOptions(env: Env): ApiClientOptions | undefined {
  const cacheKey = env.TELEGRAM_PROXY_ENABLED ? 'proxy' : 'none';
  if (clientOptionsCache.has(cacheKey)) {
    return clientOptionsCache.get(cacheKey);
  }

  const agent = getBotApiProxyAgent(env);
  if (!agent) {
    clientOptionsCache.set(cacheKey, undefined);
    return undefined;
  }

  const options: ApiClientOptions = {
    baseFetchConfig: {
      agent,
    },
  };
  clientOptionsCache.set(cacheKey, options);
  return options;
}

export { getTelegramProxy };
