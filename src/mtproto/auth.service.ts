import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';
import { createFreshClient } from './clientFactory.js';
import { logger } from '../core/logger.js';
import {
  invokeAuthSendCode,
  diagnosticsToLogMeta,
  formatTelegramRpcError,
  getClientDcId,
  type AuthCodeDelivery,
  type AuthCodeDiagnostics,
} from './authDiagnostics.js';
import {
  setAuthSession,
  getAuthSession,
  clearAuthSession,
} from './authSession.store.js';

export type { AuthCodeDelivery } from './authDiagnostics.js';

export interface AuthCodeSentInfo {
  delivery: AuthCodeDelivery;
  isCodeViaApp: boolean;
  smsResendUnavailable: boolean;
  diagnosticsSummary: string;
  diagnosticsHint: string;
  diagnostics?: AuthCodeDiagnostics;
}

export async function beginAuthSession(
  userId: number,
  apiId: number,
  apiHash: string,
  phone: string,
): Promise<AuthCodeSentInfo> {
  await clearAuthSession(userId);

  const client = await createFreshClient(apiId, apiHash, '');
  const sent = await requestAuthCode(client, apiId, apiHash, phone, false);

  setAuthSession({
    userId,
    client,
    apiId,
    apiHash,
    phone,
    phoneCodeHash: sent.phoneCodeHash,
    authMethod: 'phone',
  });

  return toAuthCodeSentInfo(sent);
}

export async function resendAuthCodeSms(userId: number): Promise<AuthCodeSentInfo> {
  const session = requireAuthSession(userId);
  const sent = await requestAuthCode(
    session.client,
    session.apiId,
    session.apiHash,
    session.phone,
    true,
  );

  session.phoneCodeHash = sent.phoneCodeHash;

  return toAuthCodeSentInfo(sent);
}

export async function signInAuthSession(
  userId: number,
  code: string,
): Promise<{ needPassword: boolean; passwordHint?: string }> {
  const session = requireAuthSession(userId);
  return signInWithCode(session.client, session.phone, session.phoneCodeHash, code);
}

export async function signInAuthSessionPassword(
  userId: number,
  password: string,
): Promise<void> {
  const session = requireAuthSession(userId);
  await signInWithPassword(session.client, password);
}

export interface AuthFinalizeResult {
  sessionString: string;
  isPremium: boolean;
  isRestricted: boolean;
  restrictionReason?: string;
  apiId: number;
  apiHash: string;
  phone: string;
}

export async function finalizeAuthSession(
  userId: number,
): Promise<AuthFinalizeResult> {
  const session = requireAuthSession(userId);

  const sessionString = await getSessionString(session.client);
  const health = await checkAccountHealth(session.client);

  let phone = session.phone;
  if (!phone) {
    const me = await session.client.getMe();
    phone = me.phone ? `+${me.phone}` : '';
  }

  const result: AuthFinalizeResult = {
    sessionString,
    isPremium: health.isPremium,
    isRestricted: health.isRestricted,
    restrictionReason: health.restrictionReason,
    apiId: session.apiId,
    apiHash: session.apiHash,
    phone,
  };

  await clearAuthSession(userId);
  return result;
}

export async function cancelAuthSession(userId: number): Promise<void> {
  await clearAuthSession(userId);
}

async function requestAuthCode(
  client: TelegramClient,
  apiId: number,
  apiHash: string,
  phone: string,
  forceSMS: boolean,
): Promise<{
  phoneCodeHash: string;
  delivery: AuthCodeDelivery;
  isCodeViaApp: boolean;
  diagnostics: AuthCodeDiagnostics;
}> {
  logger.info(
    { phone: maskPhone(phone), forceSMS, dcId: getClientDcId(client) },
    'Requesting Telegram auth code',
  );

  try {
    const { phoneCodeHash, diagnostics } = await invokeAuthSendCode(
      client,
      apiId,
      apiHash,
      phone,
      forceSMS,
    );

    if (!phoneCodeHash) {
      throw new Error('Telegram не вернул phoneCodeHash');
    }

    const isCodeViaApp = diagnostics.delivery === 'app';

    logger.info(
      {
        phone: maskPhone(phone),
        forceSMS,
        ...diagnosticsToLogMeta(diagnostics),
      },
      'Telegram auth code request completed',
    );

    return {
      phoneCodeHash,
      delivery: diagnostics.delivery,
      isCodeViaApp,
      diagnostics,
    };
  } catch (err: unknown) {
    const rpc = formatTelegramRpcError(err);
    logger.error(
      { phone: maskPhone(phone), forceSMS, error: rpc },
      'Telegram auth code request failed',
    );
    throw new Error(rpc);
  }
}

function toAuthCodeSentInfo(sent: {
  delivery: AuthCodeDelivery;
  isCodeViaApp: boolean;
  diagnostics: AuthCodeDiagnostics;
}): AuthCodeSentInfo {
  return {
    delivery: sent.delivery,
    isCodeViaApp: sent.isCodeViaApp,
    smsResendUnavailable: sent.diagnostics.smsResendUnavailable,
    diagnosticsSummary: sent.diagnostics.summaryRu,
    diagnosticsHint: sent.diagnostics.hintRu,
    diagnostics: sent.diagnostics,
  };
}

async function signInWithCode(
  client: TelegramClient,
  phone: string,
  phoneCodeHash: string,
  code: string,
): Promise<{ needPassword: boolean; passwordHint?: string }> {
  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code,
      }),
    );
    return { needPassword: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('PHONE_CODE_INVALID')) {
      throw new Error(
        'PHONE_CODE_INVALID: код не подходит к текущему запросу бота. Не используйте код из браузера/web.telegram.org — запросите код только через бота или войдите по QR.',
      );
    }
    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
      const passwordInfo = await client.invoke(new Api.account.GetPassword());
      const hint =
        passwordInfo instanceof Api.account.Password
          ? (passwordInfo.hint ?? undefined)
          : undefined;
      return { needPassword: true, passwordHint: hint };
    }
    throw err;
  }
}

async function signInWithPassword(
  client: TelegramClient,
  password: string,
): Promise<void> {
  const passwordInfo = await client.invoke(new Api.account.GetPassword());
  if (!(passwordInfo instanceof Api.account.Password)) {
    throw new Error('Could not get password info');
  }

  const { computeCheck } = await import('telegram/Password.js');
  const inputCheckPassword = await computeCheck(passwordInfo, password);

  await client.invoke(
    new Api.auth.CheckPassword({ password: inputCheckPassword }),
  );
}

async function getSessionString(client: TelegramClient): Promise<string> {
  return (client.session as StringSession).save();
}

async function checkAccountHealth(client: TelegramClient): Promise<{
  isPremium: boolean;
  isRestricted: boolean;
  restrictionReason?: string;
}> {
  const me = await client.getMe();
  const user = me as Api.User;

  const isPremium = user.premium === true;
  const isRestricted = user.restricted === true;
  const restrictionReason =
    isRestricted && Array.isArray(user.restrictionReason)
      ? user.restrictionReason.map((r: Api.RestrictionReason) => r.reason).join(', ')
      : undefined;

  return { isPremium, isRestricted, restrictionReason };
}

function requireAuthSession(userId: number) {
  const session = getAuthSession(userId);
  if (!session) {
    throw new Error('Сессия авторизации не найдена. Начните добавление аккаунта заново.');
  }
  return session;
}

function maskPhone(phone: string): string {
  if (phone.length < 5) return '***';
  return phone.slice(0, 3) + '***' + phone.slice(-2);
}
