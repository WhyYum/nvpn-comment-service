import { AccountRole, LogLevel } from '../database/types.js';
import { getActiveAccounts } from '../services/accounts.service.js';
import { searchPublicChannelPosts } from '../mtproto/parser.service.js';
import { classifyTelegramError } from '../mtproto/errors.js';
import { savePost } from '../services/posts.service.js';
import { writeLog } from '../services/logs.service.js';
import { logger } from '../core/logger.js';
import { setAccountRestricted } from '../services/accounts.service.js';
import { notifyAccountRestriction } from '../services/notifications.service.js';
import { delay } from '../utils/delay.js';
import { getClient } from '../mtproto/clientFactory.js';
import { bootstrapApp } from '../app/bootstrap.js';
import { resolveNextParserTask } from '../services/parser-scheduler.service.js';
import { recordParserRequest } from '../services/parser-limits.service.js';
import { getDefaultParserSettings } from '../services/parser-settings.service.js';
import type { Env } from '../config/env.js';

async function runParserCycle(env: Env): Promise<void> {
  const settings = await getDefaultParserSettings();

  logger.info('Parser cycle started (one keyword per interval)');

  const parsers = await getActiveAccounts(AccountRole.PARSER);
  if (parsers.length === 0) {
    await writeLog({
      level: LogLevel.WARN,
      eventType: 'PARSER_SKIP',
      message:
        'Нет активных аккаунтов с ролью PARSER. Добавьте парсер и убедитесь, что статус ACTIVE (не Стоп).',
    });
    return;
  }

  const task = await resolveNextParserTask(settings);
  if (!task) {
    await writeLog({
      level: LogLevel.WARN,
      eventType: 'PARSER_SKIP',
      message:
        'Пропуск цикла: нет доступного парсера с остатком дневного лимита запросов или нет ключевых слов.',
      meta: {
        dailyLimit: settings.dailyRequestLimit,
        activeParsers: parsers.length,
      },
    });
    return;
  }

  const { account, keyword, category, remainingRequests } = task;

  logger.info(
    {
      accountId: account.id,
      keyword: keyword.text,
      category,
      remainingRequests,
      dailyLimit: settings.dailyRequestLimit,
    },
    'Parser task selected',
  );

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
    return;
  }

  try {
    await writeLog({
      level: LogLevel.INFO,
      eventType: 'PARSER_SEARCH_START',
      message: `Searching for: ${keyword.text}`,
      accountId: account.id,
      meta: {
        keyword: keyword.text,
        category,
        remainingRequests,
        dailyLimit: settings.dailyRequestLimit,
      },
    });

    await recordParserRequest(account.id);

    const searchResult = await searchPublicChannelPosts(
      client,
      keyword.text,
      settings.postsPerKeywordLimit,
    );

    let saved = 0;
    for (const post of searchResult.posts) {
      const result = await savePost(post.postLink, keyword.text, category);
      if (result.created) saved++;
    }

    await writeLog({
      level: LogLevel.INFO,
      eventType: 'PARSER_SEARCH_DONE',
      message: `Found ${searchResult.posts.length} posts (${searchResult.mode}), saved ${saved} new`,
      accountId: account.id,
      meta: {
        keyword: keyword.text,
        category,
        found: searchResult.posts.length,
        saved,
        searchMode: searchResult.mode,
        modesUsed: searchResult.modesUsed.join(','),
        floodNote: searchResult.floodNote,
        postsLimit: settings.postsPerKeywordLimit,
        remainingRequestsAfter: Math.max(0, remainingRequests - 1),
      },
    });

    logger.info(
      {
        accountId: account.id,
        keyword: keyword.text,
        found: searchResult.posts.length,
        saved,
      },
      'Parser search completed',
    );
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
    }
  }
}

async function startParserWorker(env: Env): Promise<void> {
  const initialSettings = await getDefaultParserSettings();

  logger.info(
    {
      intervalSeconds: initialSettings.intervalSeconds,
      dailyRequestLimit: initialSettings.dailyRequestLimit,
      postsPerKeywordLimit: initialSettings.postsPerKeywordLimit,
    },
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

    const settings = await getDefaultParserSettings();
    await delay(settings.intervalSeconds * 1000);
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
