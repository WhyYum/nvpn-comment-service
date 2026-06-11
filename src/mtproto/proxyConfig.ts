import type { TelegramClientParams } from 'telegram/client/telegramBaseClient.js';
import type { ProxyInterface } from 'telegram/network/connection/TCPMTProxy.js';

export interface MtProxyEnv {
  enabled: boolean;
  type: 'socks5' | 'socks4' | 'mtproxy';
  host: string;
  port: number;
  username?: string;
  password?: string;
  secret?: string;
}

export function parseMtProxyEnv(raw: {
  MT_PROXY_ENABLED?: string;
  MT_PROXY_TYPE?: string;
  MT_PROXY_HOST?: string;
  MT_PROXY_PORT?: string;
  MT_PROXY_USERNAME?: string;
  MT_PROXY_PASSWORD?: string;
  MT_PROXY_SECRET?: string;
}): MtProxyEnv | null {
  const enabled =
    raw.MT_PROXY_ENABLED === 'true' ||
    raw.MT_PROXY_ENABLED === '1' ||
    raw.MT_PROXY_ENABLED === 'yes';

  if (!enabled) return null;

  const host = raw.MT_PROXY_HOST?.trim();
  const port = parseInt(raw.MT_PROXY_PORT ?? '', 10);

  if (!host || isNaN(port)) {
    console.error('MT_PROXY_ENABLED=true but MT_PROXY_HOST or MT_PROXY_PORT is invalid');
    process.exit(1);
  }

  const typeRaw = (raw.MT_PROXY_TYPE ?? 'socks5').toLowerCase();
  const type =
    typeRaw === 'socks4' ? 'socks4' : typeRaw === 'mtproxy' ? 'mtproxy' : 'socks5';

  return {
    enabled: true,
    type,
    host,
    port,
    username: raw.MT_PROXY_USERNAME?.trim() || undefined,
    password: raw.MT_PROXY_PASSWORD?.trim() || undefined,
    secret: raw.MT_PROXY_SECRET?.trim() || undefined,
  };
}

export function buildGramJsProxy(config: MtProxyEnv): ProxyInterface {
  if (config.type === 'mtproxy') {
    if (!config.secret) {
      throw new Error('MT_PROXY_SECRET is required for mtproxy type');
    }
    return {
      ip: config.host,
      port: config.port,
      secret: config.secret,
      MTProxy: true,
      username: config.username,
      password: config.password,
    };
  }

  return {
    ip: config.host,
    port: config.port,
    socksType: config.type === 'socks4' ? 4 : 5,
    username: config.username,
    password: config.password,
  };
}

export function getTelegramClientOptions(
  proxy: MtProxyEnv | null,
  overrides?: Partial<TelegramClientParams>,
): TelegramClientParams {
  const base: TelegramClientParams = {
    connectionRetries: 5,
    retryDelay: 2000,
    autoReconnect: false,
    useWSS: false,
    ...overrides,
  };

  if (proxy) {
    base.proxy = buildGramJsProxy(proxy);
  }

  return base;
}
