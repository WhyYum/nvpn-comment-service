import { eq, and, desc, ilike, count, gte } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { logEntries, telegramAccounts, sendAttempts, foundPosts } from '../database/schema/index.js';
import { newId } from '../database/id.js';
import type { LogLevel } from '../database/types.js';
import { formatDateTime } from '../utils/dates.js';
import { escapeTelegramHtml } from '../utils/formatters.js';

export interface LogFilter {
  level?: LogLevel;
  accountId?: string;
  eventType?: string;
  limit?: number;
}

export async function getLogs(filter: LogFilter = {}) {
  const conditions = [];

  if (filter.level) {
    conditions.push(eq(logEntries.level, filter.level));
  }
  if (filter.accountId) {
    conditions.push(eq(logEntries.accountId, filter.accountId));
  }
  if (filter.eventType) {
    conditions.push(ilike(logEntries.eventType, `%${filter.eventType}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return getDb()
    .select({
      id: logEntries.id,
      level: logEntries.level,
      eventType: logEntries.eventType,
      message: logEntries.message,
      accountId: logEntries.accountId,
      meta: logEntries.meta,
      createdAt: logEntries.createdAt,
      account: {
        phone: telegramAccounts.phone,
      },
    })
    .from(logEntries)
    .leftJoin(telegramAccounts, eq(logEntries.accountId, telegramAccounts.id))
    .where(whereClause)
    .orderBy(desc(logEntries.createdAt))
    .limit(filter.limit ?? 20);
}

const LOGS_EXPORT_LIMIT = 10_000;

export function formatLogEntryPlain(entry: {
  level: LogLevel;
  eventType: string;
  message: string;
  createdAt: Date;
  account?: { phone: string | null } | null;
  meta?: unknown;
}): string {
  const levelEmoji = entry.level === 'ERROR' ? '🔴' : entry.level === 'WARN' ? '🟡' : '🟢';
  const phone = entry.account?.phone ? ` [${entry.account.phone}]` : '';
  const meta =
    entry.meta != null && entry.meta !== undefined
      ? `\nmeta: ${JSON.stringify(entry.meta)}`
      : '';
  return `${levelEmoji} ${formatDateTime(entry.createdAt)}${phone}\n${entry.eventType}: ${entry.message}${meta}`;
}

export async function buildLogsExportFile(
  filter: LogFilter = {},
): Promise<{ content: string; count: number }> {
  const logs = await getLogs({ ...filter, limit: LOGS_EXPORT_LIMIT });
  if (logs.length === 0) {
    return { content: 'Логов нет.\n', count: 0 };
  }
  const content = logs
    .map((entry) =>
      formatLogEntryPlain({
        level: entry.level as LogLevel,
        eventType: entry.eventType,
        message: entry.message,
        createdAt: entry.createdAt,
        account: entry.account,
        meta: entry.meta,
      }),
    )
    .join('\n\n---\n\n');
  return { content, count: logs.length };
}

export function formatLogEntry(entry: {
  level: LogLevel;
  eventType: string;
  message: string;
  createdAt: Date;
  account?: { phone: string | null } | null;
}): string {
  const levelEmoji = entry.level === 'ERROR' ? '🔴' : entry.level === 'WARN' ? '🟡' : '🟢';
  const phone = entry.account?.phone
    ? ` [${escapeTelegramHtml(entry.account.phone)}]`
    : '';
  const eventType = escapeTelegramHtml(entry.eventType);
  const message = escapeTelegramHtml(entry.message);
  return `${levelEmoji} ${formatDateTime(entry.createdAt)}${phone}\n<code>${eventType}</code>: ${message}`;
}

export async function createSendAttempt(data: {
  postId: string;
  accountId: string;
  success: boolean;
  errorText?: string | null;
}) {
  await getDb().insert(sendAttempts).values({
    id: newId(),
    postId: data.postId,
    accountId: data.accountId,
    success: data.success,
    errorText: data.errorText ?? null,
  });
}

export async function countFoundPostsToday(accountId: string, since: Date) {
  const [row] = await getDb()
    .select({ count: count() })
    .from(foundPosts)
    .where(
      and(
        eq(foundPosts.senderAccountId, accountId),
        eq(foundPosts.status, 'SUCCESS'),
        gte(foundPosts.sentAt, since),
      ),
    );
  return row?.count ?? 0;
}

export async function countSendAttemptsToday(accountId: string, since: Date) {
  const [row] = await getDb()
    .select({ count: count() })
    .from(sendAttempts)
    .where(
      and(
        eq(sendAttempts.accountId, accountId),
        eq(sendAttempts.success, false),
        gte(sendAttempts.createdAt, since),
      ),
    );
  return row?.count ?? 0;
}
