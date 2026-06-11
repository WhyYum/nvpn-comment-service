import { eq, and, gte, count } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { telegramAccounts, foundPosts } from '../database/schema/index.js';
import { AccountRole, AccountStatus, PostStatus } from '../database/types.js';
import { startOfDay, startOfWeek, startOfMonth } from '../utils/dates.js';

export interface SystemStats {
  parsers: number;
  senders: number;
  premiumAccounts: number;
  spamBlockAccounts: number;
  totalPosts: number;
  pendingPosts: number;
  successPosts: number;
  errorPosts: number;
  sentToday: number;
  sentThisWeek: number;
  sentThisMonth: number;
}

export async function getSystemStats(): Promise<SystemStats> {
  const db = getDb();

  const [
    [parsersRow],
    [sendersRow],
    [premiumRow],
    [spamBlockRow],
    [totalPostsRow],
    [pendingPostsRow],
    [successPostsRow],
    [errorPostsRow],
    [sentTodayRow],
    [sentThisWeekRow],
    [sentThisMonthRow],
  ] = await Promise.all([
    db.select({ count: count() }).from(telegramAccounts).where(eq(telegramAccounts.role, AccountRole.PARSER)),
    db.select({ count: count() }).from(telegramAccounts).where(eq(telegramAccounts.role, AccountRole.SENDER)),
    db.select({ count: count() }).from(telegramAccounts).where(eq(telegramAccounts.isPremium, true)),
    db.select({ count: count() }).from(telegramAccounts).where(eq(telegramAccounts.status, AccountStatus.SPAM_BLOCK)),
    db.select({ count: count() }).from(foundPosts),
    db.select({ count: count() }).from(foundPosts).where(eq(foundPosts.status, PostStatus.PENDING)),
    db.select({ count: count() }).from(foundPosts).where(eq(foundPosts.status, PostStatus.SUCCESS)),
    db.select({ count: count() }).from(foundPosts).where(eq(foundPosts.status, PostStatus.ERROR)),
    db
      .select({ count: count() })
      .from(foundPosts)
      .where(and(eq(foundPosts.status, PostStatus.SUCCESS), gte(foundPosts.sentAt, startOfDay()))),
    db
      .select({ count: count() })
      .from(foundPosts)
      .where(and(eq(foundPosts.status, PostStatus.SUCCESS), gte(foundPosts.sentAt, startOfWeek()))),
    db
      .select({ count: count() })
      .from(foundPosts)
      .where(and(eq(foundPosts.status, PostStatus.SUCCESS), gte(foundPosts.sentAt, startOfMonth()))),
  ]);

  return {
    parsers: parsersRow?.count ?? 0,
    senders: sendersRow?.count ?? 0,
    premiumAccounts: premiumRow?.count ?? 0,
    spamBlockAccounts: spamBlockRow?.count ?? 0,
    totalPosts: totalPostsRow?.count ?? 0,
    pendingPosts: pendingPostsRow?.count ?? 0,
    successPosts: successPostsRow?.count ?? 0,
    errorPosts: errorPostsRow?.count ?? 0,
    sentToday: sentTodayRow?.count ?? 0,
    sentThisWeek: sentThisWeekRow?.count ?? 0,
    sentThisMonth: sentThisMonthRow?.count ?? 0,
  };
}
