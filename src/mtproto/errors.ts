import { AccountStatus, type AccountStatus as AccountStatusType } from '../database/types.js';

export interface ErrorClassification {
  isCritical: boolean;
  status?: AccountStatusType;
  reason: string;
}

export function classifyTelegramError(err: unknown): ErrorClassification {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('flood') || lower.includes('floodwait') || lower.includes('flood_wait')) {
    return {
      isCritical: true,
      status: AccountStatus.FLOOD_WAIT,
      reason: message.slice(0, 200),
    };
  }

  if (
    lower.includes('spam') ||
    lower.includes('peer_flood') ||
    lower.includes('userrestricted') ||
    lower.includes('chat_write_forbidden')
  ) {
    return {
      isCritical: true,
      status: AccountStatus.SPAM_BLOCK,
      reason: message.slice(0, 200),
    };
  }

  if (
    lower.includes('auth') ||
    lower.includes('session') ||
    lower.includes('unauthorized') ||
    lower.includes('user_deactivated')
  ) {
    return {
      isCritical: true,
      status: AccountStatus.AUTH_ERROR,
      reason: message.slice(0, 200),
    };
  }

  if (lower.includes('banned') || lower.includes('user_banned')) {
    return {
      isCritical: true,
      status: AccountStatus.BANNED,
      reason: message.slice(0, 200),
    };
  }

  return {
    isCritical: false,
    reason: message.slice(0, 200),
  };
}
