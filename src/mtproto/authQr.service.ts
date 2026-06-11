import { createFreshClient } from './clientFactory.js';
import { logger } from '../core/logger.js';
import { formatTelegramRpcError } from './authDiagnostics.js';
import { buildTelegramLoginUrl } from '../utils/qrLogin.js';
import {
  setAuthSession,
  getAuthSession,
  clearAuthSession,
  clearQrRuntime,
  getQrRuntime,
  setQrRuntime,
  type QrAuthRuntime,
} from './authSession.store.js';

export type QrAuthStatus = QrAuthRuntime['status'];

export async function startQrAuthWorker(
  userId: number,
  apiId: number,
  apiHash: string,
): Promise<void> {
  await clearAuthSession(userId);

  const client = await createFreshClient(apiId, apiHash, '');

  setAuthSession({
    userId,
    client,
    apiId,
    apiHash,
    phone: '',
    phoneCodeHash: '',
    authMethod: 'qr',
  });

  setQrRuntime(userId, {
    status: 'waiting_scan',
    loginUrl: '',
    expires: 0,
  });

  void runQrAuthWorker(userId, apiId, apiHash, client);
}

const qrPasswordWaiters = new Map<
  number,
  { resolve: (password: string) => void; reject: (err: Error) => void }
>();

export function submitQrAuthPassword(userId: number, password: string): void {
  const waiter = qrPasswordWaiters.get(userId);
  if (!waiter) {
    throw new Error('2FA для QR не ожидается. Дождитесь запроса пароля.');
  }
  waiter.resolve(password);
}

async function runQrAuthWorker(
  userId: number,
  apiId: number,
  apiHash: string,
  client: import('telegram').TelegramClient,
): Promise<void> {
  try {
    await client.signInUserWithQrCode(
      { apiId, apiHash },
      {
        qrCode: async ({ token, expires }) => {
          const loginUrl = buildTelegramLoginUrl(token);
          const runtime = getQrRuntime(userId);
          if (runtime && runtime.status === 'waiting_scan') {
            setQrRuntime(userId, {
              ...runtime,
              loginUrl,
              expires,
            });
          }
          logger.info({ userId, expires }, 'QR login token refreshed');
          await sleep(28000);
        },
        password: async (hint) => {
          setQrRuntime(userId, {
            status: 'password',
            loginUrl: '',
            expires: 0,
            passwordHint: hint,
          });
          return new Promise<string>((resolve, reject) => {
            qrPasswordWaiters.set(userId, { resolve, reject });
          });
        },
        onError: async (err) => {
          const msg = err.message || String(err);
          setQrRuntime(userId, {
            status: 'error',
            loginUrl: '',
            expires: 0,
            error: msg,
          });
          logger.error({ userId, err: msg }, 'QR auth error');
          return true;
        },
      },
    );

    const me = await client.getMe();
    const phone = me.phone ? `+${me.phone}` : '';

    const session = getAuthSession(userId);
    if (session) {
      session.phone = phone;
    }

    setQrRuntime(userId, {
      status: 'done',
      loginUrl: '',
      expires: 0,
      phone,
    });

    logger.info({ userId, phone: maskPhone(phone) }, 'QR auth completed');
  } catch (err: unknown) {
    const msg = formatTelegramRpcError(err);
    setQrRuntime(userId, {
      status: 'error',
      loginUrl: '',
      expires: 0,
      error: msg,
    });
    logger.error({ userId, error: msg }, 'QR auth worker failed');
  } finally {
    qrPasswordWaiters.delete(userId);
  }
}

export function getQrAuthStatus(userId: number): QrAuthRuntime | undefined {
  return getQrRuntime(userId);
}

export function isPhoneCodeInvalidError(err: unknown): boolean {
  const msg = formatTelegramRpcError(err);
  return msg.includes('PHONE_CODE_INVALID');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskPhone(phone: string): string {
  if (phone.length < 5) return '***';
  return phone.slice(0, 3) + '***' + phone.slice(-2);
}
