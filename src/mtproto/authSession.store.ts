import { TelegramClient } from 'telegram';

export type AuthMethod = 'phone' | 'qr';

export interface PendingAuthSession {
  client: TelegramClient;
  apiId: number;
  apiHash: string;
  phone: string;
  phoneCodeHash: string;
  authMethod: AuthMethod;
}

export type QrAuthStatus = 'waiting_scan' | 'password' | 'done' | 'error';

export interface QrAuthRuntime {
  status: QrAuthStatus;
  loginUrl: string;
  expires: number;
  passwordHint?: string;
  error?: string;
  phone?: string;
}

const sessions = new Map<number, PendingAuthSession>();
const qrRuntimes = new Map<number, QrAuthRuntime>();

export function setAuthSession(params: {
  userId: number;
  client: TelegramClient;
  apiId: number;
  apiHash: string;
  phone: string;
  phoneCodeHash: string;
  authMethod?: AuthMethod;
}): void {
  const existing = sessions.get(params.userId);
  if (existing) {
    existing.client.disconnect().catch(() => undefined);
  }

  sessions.set(params.userId, {
    client: params.client,
    apiId: params.apiId,
    apiHash: params.apiHash,
    phone: params.phone,
    phoneCodeHash: params.phoneCodeHash,
    authMethod: params.authMethod ?? 'phone',
  });
}

export function getAuthSession(userId: number): PendingAuthSession | undefined {
  return sessions.get(userId);
}

export function setQrRuntime(userId: number, runtime: QrAuthRuntime): void {
  qrRuntimes.set(userId, runtime);
}

export function getQrRuntime(userId: number): QrAuthRuntime | undefined {
  return qrRuntimes.get(userId);
}

export function clearQrRuntime(userId: number): void {
  qrRuntimes.delete(userId);
}

export async function clearAuthSession(userId: number): Promise<void> {
  const session = sessions.get(userId);
  if (session) {
    try {
      await session.client.disconnect();
    } catch {
      // ignore
    }
    sessions.delete(userId);
  }
  clearQrRuntime(userId);
}
