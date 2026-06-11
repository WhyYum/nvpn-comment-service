import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
export type AuthCodeDelivery =
  | 'app'
  | 'sms'
  | 'call'
  | 'flash_call'
  | 'missed_call'
  | 'email'
  | 'unknown';

export interface AuthCodeDiagnostics {
  resultClass: string;
  codeType: string;
  delivery: AuthCodeDelivery;
  codeLength?: number;
  timeoutSeconds?: number;
  nextCodeType?: string;
  phoneCodeHashPresent: boolean;
  dcId?: number;
  forceSMS: boolean;
  smsResendUnavailable: boolean;
  hintRu: string;
  summaryRu: string;
  details: Record<string, unknown>;
}

export function isSendCodeUnavailableError(err: unknown): boolean {
  const msg = formatTelegramRpcError(err);
  return msg.includes('SEND_CODE_UNAVAILABLE');
}

export function formatTelegramRpcError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as {
      errorMessage?: string;
      message?: string;
      seconds?: number;
      code?: number;
    };
    if (e.errorMessage) {
      const wait =
        typeof e.seconds === 'number' && e.seconds > 0
          ? ` (подождите ${e.seconds} сек.)`
          : '';
      return `${e.errorMessage}${wait}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export function getClientDcId(client: TelegramClient): number | undefined {
  const dcId = (client.session as { dcId?: number }).dcId;
  return typeof dcId === 'number' ? dcId : undefined;
}

export async function invokeAuthSendCode(
  client: TelegramClient,
  apiId: number,
  apiHash: string,
  phone: string,
  forceSMS: boolean,
): Promise<{
  phoneCodeHash: string;
  diagnostics: AuthCodeDiagnostics;
}> {
  try {
    const sendResult = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      }),
    );

    if (sendResult instanceof Api.auth.SentCodeSuccess) {
      throw new Error(
        'AUTH_ALREADY_AUTHORIZED: Telegram вернул SentCodeSuccess — сессия уже авторизована на этом api_id',
      );
    }

    if (!(sendResult instanceof Api.auth.SentCode)) {
      const unknown = sendResult as { className?: string };
      throw new Error(
        `Неожиданный ответ SendCode: ${unknown.className ?? typeof sendResult}`,
      );
    }

    let finalResult = sendResult;
    let usedResend = false;
    let smsResendUnavailable = false;

    const isApp = sendResult.type instanceof Api.auth.SentCodeTypeApp;
    const isSms = sendResult.type instanceof Api.auth.SentCodeTypeSms;

    if (forceSMS && !isSms) {
      try {
        const resendResult = await client.invoke(
          new Api.auth.ResendCode({
            phoneNumber: phone,
            phoneCodeHash: sendResult.phoneCodeHash,
          }),
        );
        usedResend = true;

        if (resendResult instanceof Api.auth.SentCodeSuccess) {
          throw new Error(
            'AUTH_ALREADY_AUTHORIZED: после ResendCode Telegram вернул SentCodeSuccess',
          );
        }

        if (!(resendResult instanceof Api.auth.SentCode)) {
          const unknown = resendResult as { className?: string };
          throw new Error(
            `Неожиданный ответ ResendCode: ${unknown.className ?? typeof resendResult}`,
          );
        }

        finalResult = resendResult;
      } catch (resendErr: unknown) {
        if (isSendCodeUnavailableError(resendErr)) {
          smsResendUnavailable = true;
          finalResult = sendResult;
        } else {
          throw resendErr;
        }
      }
    }

    const diagnostics = buildDiagnostics(
      finalResult,
      forceSMS,
      getClientDcId(client),
      { usedResend, smsResendUnavailable },
    );

    return {
      phoneCodeHash: finalResult.phoneCodeHash,
      diagnostics,
    };
  } catch (err: unknown) {
    const rpc = formatTelegramRpcError(err);
    if (rpc === 'AUTH_RESTART') {
      return invokeAuthSendCode(client, apiId, apiHash, phone, forceSMS);
    }
    throw err;
  }
}

function buildDiagnostics(
  sent: Api.auth.SentCode,
  forceSMS: boolean,
  dcId: number | undefined,
  extra: Record<string, unknown>,
): AuthCodeDiagnostics {
  const codeType = sent.type.className;
  const delivery = mapDelivery(sent.type);
  const codeLength = readCodeLength(sent.type);
  const nextCodeType = sent.nextType?.className;
  const details: Record<string, unknown> = {
    ...extra,
    codeType,
    timeout: sent.timeout,
    nextType: nextCodeType,
    codeLength,
    ...serializeTypeFields(sent.type),
  };

  const smsResendUnavailable = extra.smsResendUnavailable === true;
  let hintRu = buildHintRu(delivery, sent, details);
  if (smsResendUnavailable) {
    hintRu +=
      ' SMS недоступен (SEND_CODE_UNAVAILABLE): Telegram отклонил ResendCode. Код уже запрошен в приложение — чат «Telegram».';
  }
  const summaryRu = [
    `тип: ${codeType}`,
    codeLength ? `длина кода: ${codeLength}` : null,
    sent.timeout ? `повтор через: ${sent.timeout} с` : null,
    nextCodeType ? `следующий способ: ${nextCodeType}` : null,
    typeof dcId === 'number' ? `DC: ${dcId}` : null,
    forceSMS ? 'запрошен SMS' : null,
    smsResendUnavailable ? 'SMS: недоступен' : null,
  ]
    .filter(Boolean)
    .join('; ');

  return {
    resultClass: sent.className,
    codeType,
    delivery,
    codeLength,
    timeoutSeconds: sent.timeout,
    nextCodeType,
    phoneCodeHashPresent: Boolean(sent.phoneCodeHash),
    dcId,
    forceSMS,
    smsResendUnavailable,
    hintRu,
    summaryRu,
    details,
  };
}

function mapDelivery(type: Api.auth.TypeSentCodeType): AuthCodeDelivery {
  if (type instanceof Api.auth.SentCodeTypeApp) return 'app';
  if (type instanceof Api.auth.SentCodeTypeSms) return 'sms';
  if (type instanceof Api.auth.SentCodeTypeCall) return 'call';
  if (type instanceof Api.auth.SentCodeTypeFlashCall) return 'flash_call';
  if (type instanceof Api.auth.SentCodeTypeMissedCall) return 'missed_call';
  if (type instanceof Api.auth.SentCodeTypeEmailCode) return 'email';
  if (type instanceof Api.auth.SentCodeTypeSetUpEmailRequired) return 'email';
  return 'unknown';
}

function readCodeLength(type: Api.auth.TypeSentCodeType): number | undefined {
  if ('length' in type && typeof (type as { length?: number }).length === 'number') {
    return (type as { length: number }).length;
  }
  return undefined;
}

function serializeTypeFields(type: Api.auth.TypeSentCodeType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (type instanceof Api.auth.SentCodeTypeFlashCall) {
    out.pattern = type.pattern;
  }
  if (type instanceof Api.auth.SentCodeTypeMissedCall) {
    out.prefix = type.prefix;
    out.length = type.length;
  }
  if (type instanceof Api.auth.SentCodeTypeEmailCode) {
    out.emailPattern = type.emailPattern;
  }
  if (type instanceof Api.auth.SentCodeTypeFragmentSms) {
    out.url = type.url;
  }
  return out;
}

function buildHintRu(
  delivery: AuthCodeDelivery,
  sent: Api.auth.SentCode,
  details: Record<string, unknown>,
): string {
  switch (delivery) {
    case 'app':
      return (
        'Telegram выбрал доставку в приложение (чат «Telegram»). SMS не отправляется, пока не истечёт timeout или вы не нажмёте «отправить SMS».'
      );
    case 'sms':
      return 'Telegram сообщил, что код уходит по SMS (или как SMS-слово/фраза). Проверьте сообщения оператора.';
    case 'call':
      return 'Код придёт голосовым звонком — ответьте и прослушайте цифры.';
    case 'flash_call':
      return `Ожидается flash-call: номер должен совпасть с шаблоном ${String(details.pattern ?? '')}.`;
    case 'missed_call':
      return `Ожидается пропущенный звонок с префиксом ${String(details.prefix ?? '')} — код в последних цифрах номера.`;
    case 'email':
      if (sent.type instanceof Api.auth.SentCodeTypeSetUpEmailRequired) {
        return 'Telegram требует привязать email к аккаунту перед входом по API — сделайте это в официальном клиенте.';
      }
      return `Код уходит на email ${String(details.emailPattern ?? 'привязанный к аккаунту')}.`;
    default:
      return `Неизвестный тип доставки (${sent.type.className}). Смотрите полный лог AUTH_CODE_SENT.`;
  }
}

export function diagnosticsToLogMeta(d: AuthCodeDiagnostics): Record<string, unknown> {
  return {
    resultClass: d.resultClass,
    codeType: d.codeType,
    delivery: d.delivery,
    codeLength: d.codeLength,
    timeoutSeconds: d.timeoutSeconds,
    nextCodeType: d.nextCodeType,
    phoneCodeHashPresent: d.phoneCodeHashPresent,
    dcId: d.dcId,
    forceSMS: d.forceSMS,
    smsResendUnavailable: d.smsResendUnavailable,
    hintRu: d.hintRu,
    details: d.details,
  };
}
