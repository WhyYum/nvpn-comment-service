import { eq } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { telegramAccounts } from '../database/schema/index.js';
import { startOfDay } from '../utils/dates.js';

export interface ParserAccountUsage {
  id: string;
  phone: string;
  category: string;
  parserRequestsToday: number;
  parserRequestsDate: Date | null;
}

export function getParserRemainingRequests(
  account: ParserAccountUsage,
  dailyLimit: number,
): number {
  const today = startOfDay();
  const usageDate = account.parserRequestsDate
    ? startOfDay(account.parserRequestsDate)
    : null;

  if (!usageDate || usageDate.getTime() < today.getTime()) {
    return dailyLimit;
  }

  return Math.max(0, dailyLimit - account.parserRequestsToday);
}

export function pickParserAccount<T extends ParserAccountUsage>(
  accounts: T[],
  dailyLimit: number,
): T | null {
  const withQuota = accounts
    .map((account) => ({
      account,
      remaining: getParserRemainingRequests(account, dailyLimit),
    }))
    .filter((entry) => entry.remaining > 0);

  if (withQuota.length === 0) {
    return null;
  }

  const usedToday = withQuota.filter(
    (entry) => getParserUsageToday(entry.account) > 0,
  );

  const pool = usedToday.length > 0 ? usedToday : withQuota;

  pool.sort((a, b) => {
    const usageDiff = getParserUsageToday(b.account) - getParserUsageToday(a.account);
    if (usageDiff !== 0) return usageDiff;
    return a.account.phone.localeCompare(b.account.phone);
  });

  return pool[0]?.account ?? null;
}

function getParserUsageToday(account: ParserAccountUsage): number {
  const today = startOfDay();
  const usageDate = account.parserRequestsDate
    ? startOfDay(account.parserRequestsDate)
    : null;

  if (!usageDate || usageDate.getTime() < today.getTime()) {
    return 0;
  }

  return account.parserRequestsToday;
}

export async function recordParserRequest(accountId: string): Promise<void> {
  const today = startOfDay();
  const db = getDb();

  const [account] = await db
    .select({
      parserRequestsToday: telegramAccounts.parserRequestsToday,
      parserRequestsDate: telegramAccounts.parserRequestsDate,
    })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.id, accountId))
    .limit(1);

  if (!account) return;

  const usageDate = account.parserRequestsDate
    ? startOfDay(account.parserRequestsDate)
    : null;
  const isNewDay = !usageDate || usageDate.getTime() < today.getTime();
  const nextCount = isNewDay ? 1 : account.parserRequestsToday + 1;

  await db
    .update(telegramAccounts)
    .set({
      parserRequestsToday: nextCount,
      parserRequestsDate: today,
    })
    .where(eq(telegramAccounts.id, accountId));
}
