import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { decrypt } from '../services/encryption.service.js';
import { loadEnv, getTelegramProxy } from '../config/env.js';
import { logger } from '../core/logger.js';

type ClientOptions = ConstructorParameters<typeof TelegramClient>[3];

interface ClientCacheEntry {
  client: TelegramClient;
  accountId: string;
}

const clientCache = new Map<string, ClientCacheEntry>();

export interface AccountCredentials {
  id: string;
  apiId: number;
  apiHashEncrypted: string;
  sessionEncrypted: string;
}

function buildClientOptions(overrides?: Partial<ClientOptions>): ClientOptions {
  const proxy = getTelegramProxy(loadEnv());
  const base: ClientOptions = {
    connectionRetries: 5,
    retryDelay: 2000,
    autoReconnect: false,
    useWSS: false,
    ...(proxy ? { proxy } : {}),
  };
  return { ...base, ...overrides };
}

export async function getClient(account: AccountCredentials): Promise<TelegramClient> {
  const cached = clientCache.get(account.id);
  if (cached) {
    try {
      if (await cached.client.isUserAuthorized()) {
        return cached.client;
      }
    } catch {
      clientCache.delete(account.id);
    }
  }

  const apiHash = decrypt(account.apiHashEncrypted);
  const sessionString = decrypt(account.sessionEncrypted);
  const session = new StringSession(sessionString);

  const client = new TelegramClient(
    session,
    account.apiId,
    apiHash,
    buildClientOptions({ connectionRetries: 3 }),
  );

  await client.connect();

  clientCache.set(account.id, { client, accountId: account.id });
  logger.info({ accountId: account.id }, 'MTProto client connected');

  return client;
}

export async function disconnectClient(accountId: string): Promise<void> {
  const entry = clientCache.get(accountId);
  if (entry) {
    try {
      await entry.client.disconnect();
    } catch {
      // ignore disconnect errors
    }
    clientCache.delete(accountId);
    logger.info({ accountId }, 'MTProto client disconnected');
  }
}

export async function createFreshClient(
  apiId: number,
  apiHash: string,
  sessionString = '',
): Promise<TelegramClient> {
  const session = new StringSession(sessionString);
  const client = new TelegramClient(
    session,
    apiId,
    apiHash,
    buildClientOptions({ connectionRetries: 5 }),
  );
  await client.connect();
  return client;
}
