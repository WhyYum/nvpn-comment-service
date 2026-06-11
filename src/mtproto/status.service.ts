import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { AccountStatus, type AccountStatus as AccountStatusType } from '../database/types.js';

export interface AccountStatusResult {
  status: AccountStatusType;
  isPremium: boolean;
  statusReason?: string;
}

export async function checkAccountStatus(client: TelegramClient): Promise<AccountStatusResult> {
  const me = await client.getMe();
  const user = me as Api.User;

  const isPremium = user.premium === true;
  const isRestricted = user.restricted === true;
  const restrictionReason =
    isRestricted && Array.isArray(user.restrictionReason)
      ? user.restrictionReason.map((r: Api.RestrictionReason) => r.reason).join(', ')
      : undefined;

  if (isRestricted) {
    return {
      status: AccountStatus.NEEDS_CHECK,
      isPremium,
      statusReason: restrictionReason,
    };
  }

  return {
    status: AccountStatus.ACTIVE,
    isPremium,
  };
}
