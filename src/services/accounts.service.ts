import { eq, and, desc, sql, count, gte, inArray } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { telegramAccounts } from '../database/schema/index.js';
import { newId } from '../database/id.js';
import {
  AccountStatus,
  type AccountRole,
  type AccountCategory,
  type AccountStatus as AccountStatusType,
} from '../database/types.js';
import { encrypt } from './encryption.service.js';
import { writeLog } from './logs.service.js';
import { disconnectClient } from '../mtproto/clientFactory.js';

export interface CreateAccountData {
  phone: string;
  apiId: number;
  apiHash: string;
  sessionString: string;
  role: AccountRole;
  category: AccountCategory;
  isPremium: boolean;
}

export async function createAccount(data: CreateAccountData) {
  const apiHashEncrypted = encrypt(data.apiHash);
  const sessionEncrypted = encrypt(data.sessionString);
  const id = newId();

  const [account] = await getDb()
    .insert(telegramAccounts)
    .values({
      id,
      phone: data.phone,
      apiId: data.apiId,
      apiHashEncrypted,
      sessionEncrypted,
      role: data.role,
      category: data.category,
      isPremium: data.isPremium,
      status: AccountStatus.ACTIVE,
    })
    .returning();

  await writeLog({
    level: 'INFO',
    eventType: 'ACCOUNT_ADDED',
    message: `Account ${data.phone} added`,
    accountId: account.id,
    meta: { role: data.role, category: data.category },
  });

  return account;
}

export async function getAllAccounts() {
  return getDb().select().from(telegramAccounts).orderBy(desc(telegramAccounts.addedAt));
}

export async function getAccountById(id: string) {
  const [account] = await getDb()
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.id, id))
    .limit(1);
  return account ?? null;
}

export async function getActiveAccounts(role: AccountRole) {
  return getDb()
    .select()
    .from(telegramAccounts)
    .where(and(eq(telegramAccounts.role, role), eq(telegramAccounts.status, AccountStatus.ACTIVE)));
}

export async function startAccount(id: string) {
  await getDb()
    .update(telegramAccounts)
    .set({ status: AccountStatus.ACTIVE, statusReason: null })
    .where(eq(telegramAccounts.id, id));

  await writeLog({
    level: 'INFO',
    eventType: 'ACCOUNT_STARTED',
    message: 'Account started',
    accountId: id,
  });
}

export async function stopAccount(id: string) {
  await getDb()
    .update(telegramAccounts)
    .set({ status: AccountStatus.STOPPED })
    .where(eq(telegramAccounts.id, id));

  await disconnectClient(id);
  await writeLog({
    level: 'INFO',
    eventType: 'ACCOUNT_STOPPED',
    message: 'Account stopped',
    accountId: id,
  });
}

export async function setAccountRestricted(
  id: string,
  status: AccountStatusType,
  reason: string,
) {
  await getDb()
    .update(telegramAccounts)
    .set({ status, statusReason: reason })
    .where(eq(telegramAccounts.id, id));

  await disconnectClient(id);
  await writeLog({
    level: 'WARN',
    eventType: 'ACCOUNT_RESTRICTED',
    message: `Account restricted: ${reason}`,
    accountId: id,
    meta: { status, reason },
  });
}

export async function deleteAccount(id: string) {
  await disconnectClient(id);
  await getDb().delete(telegramAccounts).where(eq(telegramAccounts.id, id));
  await writeLog({
    level: 'INFO',
    eventType: 'ACCOUNT_DELETED',
    message: 'Account deleted',
    meta: { accountId: id },
  });
}

export async function updateAccountActivity(
  id: string,
  opts: { sentIncrement?: number; errorsIncrement?: number },
) {
  await getDb()
    .update(telegramAccounts)
    .set({
      lastActivityAt: new Date(),
      ...(opts.sentIncrement
        ? { sentTotal: sql`${telegramAccounts.sentTotal} + ${opts.sentIncrement}` }
        : {}),
      ...(opts.errorsIncrement
        ? { errorsTotal: sql`${telegramAccounts.errorsTotal} + ${opts.errorsIncrement}` }
        : {}),
    })
    .where(eq(telegramAccounts.id, id));
}

export async function updateAccountStatus(
  id: string,
  data: {
    status: AccountStatusType;
    isPremium: boolean;
    statusReason?: string | null;
  },
) {
  await getDb()
    .update(telegramAccounts)
    .set({
      status: data.status,
      isPremium: data.isPremium,
      statusReason: data.statusReason ?? null,
      lastActivityAt: new Date(),
    })
    .where(eq(telegramAccounts.id, id));
}

export async function getAllAccountsRaw() {
  return getDb().select().from(telegramAccounts);
}
