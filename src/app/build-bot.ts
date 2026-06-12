import { session, InlineKeyboard, InputFile } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import type { Env } from '../config/env.js';
import { createBot } from '../bot/createBot.js';
import { lang, t } from '../core/i18n/index.js';
import type { BotContext, OutsideCtx, InsideCtx, SessionData } from '../bot/types.js';
import { adminOnly } from '../bot/middlewares/adminOnly.middleware.js';
import { buildMainMenu } from '../bot/menus/main.menu.js';
import { buildAccountsMessage } from '../bot/menus/accounts.menu.js';
import { buildStatsMessage } from '../bot/menus/stats.menu.js';
import {
  buildLogsMenuMessage,
  buildLogsFileName,
  logsFilterLabel,
  type LogsFilter,
} from '../bot/menus/logs.menu.js';
import { buildLogsExportFile } from '../services/logs.viewer.service.js';
import { addAccountConversation } from '../bot/conversations/addAccount.conversation.js';
import { addKeywordsConversation } from '../bot/conversations/addKeywords.conversation.js';
import { addTemplatesConversation } from '../bot/conversations/addTemplates.conversation.js';
import { limitsConversation } from '../bot/conversations/limits.conversation.js';
import {
  getAccountById,
  startAccount,
  stopAccount,
  deleteAccount,
  updateAccountStatus,
  getAllAccountsRaw,
} from '../services/accounts.service.js';
import { getClient } from '../mtproto/clientFactory.js';
import { checkAccountStatus } from '../mtproto/status.service.js';
import { writeLog } from '../services/logs.service.js';
import { logger } from '../core/logger.js';
import { ensureDefaultLimitsExist } from '../services/limits.service.js';
import { ensureDefaultParserSettingsExist } from '../services/parser-settings.service.js';
import { ensureDefaultStatusSettingsExist } from '../services/status-settings.service.js';
import { formatAccountStatus } from '../utils/formatters.js';
import { AccountStatus, LogLevel, type AccountStatus as AccountStatusType } from '../database/types.js';

async function safeEditMessageHtml(
  ctx: BotContext,
  text: string,
  keyboard: InlineKeyboard,
): Promise<void> {
  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('message is not modified')) {
      return;
    }
    throw err;
  }
}

export function buildBot(env: Env) {
  const bot = createBot(env);

  bot.use(
    session<SessionData, OutsideCtx>({
      initial: () => ({} as SessionData),
    }),
  );

  bot.use(conversations<OutsideCtx, InsideCtx>());
  bot.use(createConversation<OutsideCtx, InsideCtx>(addAccountConversation, 'addAccount'));
  bot.use(createConversation<OutsideCtx, InsideCtx>(addKeywordsConversation, 'addKeywords'));
  bot.use(createConversation<OutsideCtx, InsideCtx>(addTemplatesConversation, 'addTemplates'));
  bot.use(createConversation<OutsideCtx, InsideCtx>(limitsConversation, 'limits'));

  bot.use(adminOnly);

  bot.command('start', async (ctx) => {
    await ctx.reply(lang.menu.main.title, {
      parse_mode: 'HTML',
      reply_markup: buildMainMenu(),
    });
  });

  bot.callbackQuery('menu:main', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(lang.menu.main.title, {
      parse_mode: 'HTML',
      reply_markup: buildMainMenu(),
    });
  });

  bot.callbackQuery('menu:accounts', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await buildAccountsMessage();
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.callbackQuery('menu:stats', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await buildStatsMessage();
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.callbackQuery('menu:logs', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = buildLogsMenuMessage();
    await safeEditMessageHtml(ctx, text, keyboard);
  });

  bot.callbackQuery(/^logs:filter:(.+)$/, async (ctx) => {
    const filterKey = ctx.match[1];
    const level = filterKey === 'ALL' ? undefined : (filterKey as LogLevel);
    const filter: LogsFilter = { level };

    const { content, count } = await buildLogsExportFile(filter);
    const fileName = buildLogsFileName(filterKey);
    const label = logsFilterLabel(filterKey);

    await ctx.answerCallbackQuery({
      text: count === 0 ? lang.menu.logs.empty : `Файл: ${count} записей`,
    });

    const { keyboard } = buildLogsMenuMessage();
    const caption = t(lang.menu.logs.fileCaption, { filter: label });

    await ctx.replyWithDocument(new InputFile(Buffer.from(content, 'utf-8'), fileName), {
      caption,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery('conv:addAccount', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('addAccount');
  });

  bot.callbackQuery('conv:addKeywords', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('addKeywords');
  });

  bot.callbackQuery('conv:addTemplates', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('addTemplates');
  });

  bot.callbackQuery('conv:limits', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter('limits');
  });

  bot.callbackQuery(/^acc:start:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match[1];
    await startAccount(id);
    const { text, keyboard } = await buildAccountsMessage();
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.callbackQuery(/^acc:stop:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match[1];
    await stopAccount(id);
    const { text, keyboard } = await buildAccountsMessage();
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.callbackQuery(/^acc:check:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery(lang.menu.accounts.checkStarted);
    const id = ctx.match[1];
    const account = await getAccountById(id);

    if (!account) {
      await ctx.reply(lang.common.notFound);
      return;
    }

    let statusResult: {
      status: AccountStatusType;
      isPremium: boolean;
      statusReason?: string;
    };

    try {
      const client = await getClient(account);
      statusResult = await checkAccountStatus(client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      statusResult = {
        status: AccountStatus.NEEDS_CHECK,
        isPremium: account.isPremium,
        statusReason: msg.slice(0, 200),
      };
    }

    await updateAccountStatus(id, {
      status: statusResult.status,
      isPremium: statusResult.isPremium,
      statusReason: statusResult.statusReason ?? null,
    });

    await writeLog({
      level: LogLevel.INFO,
      eventType: 'ACCOUNT_CHECKED',
      message: `Manual check: ${formatAccountStatus(statusResult.status)}`,
      accountId: id,
      meta: { status: statusResult.status },
    });

    const reasonPart = statusResult.statusReason
      ? t(lang.menu.accounts.checkReasonSuffix, { reason: statusResult.statusReason })
      : '';

    await ctx.reply(
      t(lang.menu.accounts.checkDone, {
        status: formatAccountStatus(statusResult.status),
        premium: statusResult.isPremium ? 'Да' : 'Нет',
        reason: reasonPart,
      }),
      {
        reply_markup: new InlineKeyboard()
          .text(lang.common.accountsMenu, 'menu:accounts')
          .text(lang.common.mainMenu, 'menu:main'),
      },
    );
  });

  bot.callbackQuery(/^acc:delete:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match[1];
    const account = await getAccountById(id);
    if (!account) {
      await ctx.reply(lang.common.notFound);
      return;
    }

    await ctx.reply(t(lang.menu.accounts.deleteConfirm, { phone: account.phone }), {
      reply_markup: new InlineKeyboard()
        .text(lang.menu.accounts.deleteYes, `acc:deleteConfirm:${id}`)
        .text(lang.common.cancel, 'menu:accounts'),
    });
  });

  bot.callbackQuery(/^acc:deleteConfirm:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match[1];
    await deleteAccount(id);
    const { text, keyboard } = await buildAccountsMessage();
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.callbackQuery('action:checkStatuses', async (ctx) => {
    await ctx.answerCallbackQuery(lang.statusCheck.starting);

    const accounts = await getAllAccountsRaw();
    const report = {
      total: accounts.length,
      active: 0,
      spamBlock: 0,
      floodWait: 0,
      authError: 0,
      stopped: 0,
      premium: 0,
    };

    for (const account of accounts) {
      if (account.status === AccountStatus.STOPPED) {
        report.stopped++;
        continue;
      }

      let statusResult: {
        status: AccountStatusType;
        isPremium: boolean;
        statusReason?: string;
      };

      try {
        const client = await getClient(account);
        statusResult = await checkAccountStatus(client);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        statusResult = {
          status: AccountStatus.NEEDS_CHECK,
          isPremium: account.isPremium,
          statusReason: msg.slice(0, 200),
        };
      }

      await updateAccountStatus(account.id, {
        status: statusResult.status,
        isPremium: statusResult.isPremium,
        statusReason: statusResult.statusReason ?? null,
      });

      if (statusResult.status === AccountStatus.ACTIVE) report.active++;
      else if (statusResult.status === AccountStatus.SPAM_BLOCK) report.spamBlock++;
      else if (statusResult.status === AccountStatus.FLOOD_WAIT) report.floodWait++;
      else if (statusResult.status === AccountStatus.AUTH_ERROR) report.authError++;

      if (statusResult.isPremium) report.premium++;
    }

    await ctx.reply(
      t(lang.statusCheck.report, {
        total: report.total,
        active: report.active,
        spamBlock: report.spamBlock,
        floodWait: report.floodWait,
        authError: report.authError,
        premium: report.premium,
      }),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(lang.common.mainMenu, 'menu:main'),
      },
    );
  });

  bot.catch((err) => {
    logger.error({ err: err.error }, 'Bot error');
  });

  return bot;
}

export async function startBot(env: Env) {
  await ensureDefaultLimitsExist();
  await ensureDefaultParserSettingsExist();
  await ensureDefaultStatusSettingsExist();
  const bot = buildBot(env);
  logger.info('Bot starting...');
  await bot.start({
    onStart: (info) => logger.info({ username: info.username }, 'Bot started'),
  });
}
