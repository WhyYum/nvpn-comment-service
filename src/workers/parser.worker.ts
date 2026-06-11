import { AccountRole, AccountStatus, LogLevel, type AccountCategory } from '../database/types.js';
import { getActiveAccounts } from '../services/accounts.service.js';
import { searchPublicChannelPosts } from '../mtproto/parser.service.js';
import { classifyTelegramError } from '../mtproto/errors.js';
import { savePost } from '../services/posts.service.js';
import { writeLog } from '../services/logs.service.js';
import { logger } from '../core/logger.js';
import { setAccountRestricted } from '../services/accounts.service.js';
import { notifyAccountRestriction } from '../services/notifications.service.js';
import { getKeywords } from '../services/keywords.service.js';
import { delay } from '../utils/delay.js';
import { getClient } from '../mtproto/clientFactory.js';
import { bootstrapApp } from '../app/bootstrap.js';
import type { Env } from '../config/env.js';

async function runParserCycle(env: Env): Promise<void> {
  logger.info('Parser cycle started');

  const accounts = await getActiveAccounts(AccountRole.PARSER);

  logger.info({ count: accounts.length }, 'Active parser accounts found');

  if (accounts.length === 0) {
    await writeLog({
      level: LogLevel.WARN,
      eventType: 'PARSER_SKIP',
      message:
        'Нет активных аккаунтов с ролью PARSER. Добавьте парсер и убедитесь, что статус ACTIVE (не Стоп).',
    });
    return;
  }

  let totalSearches = 0;
  let totalFound = 0;
  let totalSaved = 0;

  for (const account of accounts) {
    const keywords = await getKeywords(account.category as AccountCategory);
    if (keywords.length === 0) {
      logger.info({ accountId: account.id, category: account.category }, 'No keywords for category');
      await writeLog({
        level: LogLevel.WARN,
        eventType: 'PARSER_SKIP',
        message: `Нет ключевых слов для категории ${account.category}`,
        accountId: account.id,
        meta: { category: account.category },
      });
      continue;
    }

    let client;
    try {
      client = await getClient(account);
    } catch (err) {
      const classification = classifyTelegramError(err);
      if (classification.isCritical && classification.status) {
        await setAccountRestricted(account.id, classification.status, classification.reason);
        await notifyAccountRestriction(env, account.phone, classification.reason);
      } else {
        await writeLog({
          level: LogLevel.ERROR,
          eventType: 'PARSER_CLIENT_ERROR',
          message: `Failed to connect parser client: ${classification.reason}`,
          accountId: account.id,
        });
      }
      continue;
    }

    for (const keyword of keywords) {
      try {
        totalSearches += 1;

        await writeLog({
          level: LogLevel.INFO,
          eventType: 'PARSER_SEARCH_START',
          message: `Searching for: ${keyword.text}`,
          accountId: account.id,
          meta: { keyword: keyword.text, category: account.category },
        });

        const searchResult = await searchPublicChannelPosts(client, keyword.text);

        let saved = 0;
        for (const post of searchResult.posts) {
          const result = await savePost(
            post.postLink,
            keyword.text,
            account.category as AccountCategory,
          );
          if (result.created) saved++;
        }

        totalFound += searchResult.posts.length;
        totalSaved += saved;

        await writeLog({
          level: LogLevel.INFO,
          eventType: 'PARSER_SEARCH_DONE',
          message: `Found ${searchResult.posts.length} posts (${searchResult.mode}), saved ${saved} new`,
          accountId: account.id,
          meta: {
            keyword: keyword.text,
            found: searchResult.posts.length,
            saved,
            searchMode: searchResult.mode,
            modesUsed: searchResult.modesUsed.join(','),
            floodNote: searchResult.floodNote,
          },
        });

        await delay(2000);
      } catch (err) {
        const classification = classifyTelegramError(err);

        await writeLog({
          level: LogLevel.ERROR,
          eventType: 'PARSER_SEARCH_ERROR',
          message: `Search error for keyword "${keyword.text}": ${classification.reason}`,
          accountId: account.id,
          meta: { keyword: keyword.text, reason: classification.reason },
        });

        if (classification.isCritical && classification.status) {
          await setAccountRestricted(account.id, classification.status, classification.reason);
          await notifyAccountRestriction(env, account.phone, classification.reason);
          break;
        }
      }
    }
  }

  await writeLog({
    level: LogLevel.INFO,
    eventType: 'PARSER_CYCLE_DONE',
    message: `Цикл завершён: поисков ${totalSearches}, найдено ${totalFound}, сохранено новых ${totalSaved}`,
    meta: { totalSearches, totalFound, totalSaved },
  });

  logger.info({ totalSearches, totalFound, totalSaved }, 'Parser cycle completed');
}

async function startParserWorker(env: Env): Promise<void> {
  const parseIntervalMs = env.PARSER_INTERVAL_SECONDS * 1000;

  logger.info(
    { intervalSeconds: env.PARSER_INTERVAL_SECONDS, intervalMs: parseIntervalMs },
    'Parser worker started',
  );

  while (true) {
    try {
      await runParserCycle(env);
    } catch (err) {
      logger.error({ err }, 'Parser cycle failed');
      await writeLog({
        level: LogLevel.ERROR,
        eventType: 'PARSER_CYCLE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    await delay(parseIntervalMs);
  }
}

async function main(): Promise<void> {
  const env = await bootstrapApp();
  await startParserWorker(env);
}

main().catch((err) => {
  console.error('Parser worker fatal error:', err);
  process.exit(1);
});
