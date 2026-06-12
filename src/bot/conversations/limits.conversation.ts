import { InlineKeyboard } from 'grammy';
import {
  getDefaultLimits,
  setDefaultLimits,
  type LimitConfig,
} from '../../services/limits.service.js';
import {
  getDefaultParserSettings,
  setDefaultParserSettings,
  type ParserSettingsConfig,
} from '../../services/parser-settings.service.js';
import {
  getDefaultStatusSettings,
  setDefaultStatusSettings,
  type StatusSettingsConfig,
} from '../../services/status-settings.service.js';
import { lang, t } from '../../core/i18n/index.js';
import type { BotConversation, InsideCtx } from '../types.js';

const L = () => lang.conversations.limits;

function formatLimits(limits: LimitConfig): string {
  return t(lang.limits.format, {
    hourlyLimit: limits.hourlyLimit,
    dailyLimit: limits.dailyLimit,
    minDelaySeconds: limits.minDelaySeconds,
    maxDelaySeconds: limits.maxDelaySeconds,
  });
}

function formatParserSettings(settings: ParserSettingsConfig): string {
  return t(lang.limits.formatParser, {
    intervalSeconds: settings.intervalSeconds,
    dailyRequestLimit: settings.dailyRequestLimit,
    postsPerKeywordLimit: settings.postsPerKeywordLimit,
  });
}

function formatStatusSettings(settings: StatusSettingsConfig): string {
  return t(lang.limits.formatStatus, {
    intervalSeconds: settings.intervalSeconds,
  });
}

export async function limitsConversation(
  conversation: BotConversation,
  ctx: InsideCtx,
): Promise<void> {
  const l = L();
  const [currentLimits, parserSettings, statusSettings] = await conversation.external(() =>
    Promise.all([
      getDefaultLimits(),
      getDefaultParserSettings(),
      getDefaultStatusSettings(),
    ]),
  );

  await ctx.reply(
    `${formatLimits(currentLimits)}\n\n${formatParserSettings(parserSettings)}\n\n${formatStatusSettings(statusSettings)}\n\n${l.changePrompt}`,
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text(l.editSenderBtn, 'limits:edit')
        .row()
        .text(l.editParserBtn, 'limits:editParser')
        .row()
        .text(l.editStatusBtn, 'limits:editStatus')
        .row()
        .text(lang.common.back, 'menu:main'),
    },
  );

  const actionCtx = await conversation.waitForCallbackQuery([
    'limits:edit',
    'limits:editParser',
    'limits:editStatus',
    'menu:main',
  ]);
  await actionCtx.answerCallbackQuery();

  if (actionCtx.callbackQuery.data === 'menu:main') {
    return;
  }

  if (actionCtx.callbackQuery.data === 'limits:edit') {
    await editSenderLimits(conversation, ctx, currentLimits, l);
    return;
  }

  if (actionCtx.callbackQuery.data === 'limits:editParser') {
    await editParserSettings(conversation, ctx, parserSettings, l);
    return;
  }

  await editStatusSettings(conversation, ctx, statusSettings, l);
}

async function editSenderLimits(
  conversation: BotConversation,
  ctx: InsideCtx,
  current: LimitConfig,
  l: ReturnType<typeof L>,
): Promise<void> {
  const currentStr = `${current.hourlyLimit} ${current.dailyLimit} ${current.minDelaySeconds} ${current.maxDelaySeconds}`;
  await ctx.reply(t(l.editPrompt, { current: currentStr }), { parse_mode: 'HTML' });

  const inputCtx = await conversation.waitFor('message:text');
  const parts = inputCtx.message.text.trim().split(/\s+/);

  if (parts.length !== 4) {
    await ctx.reply(l.invalidFormat);
    return;
  }

  const [hourlyLimit, dailyLimit, minDelaySeconds, maxDelaySeconds] = parts.map(Number);

  if (
    isNaN(hourlyLimit) ||
    isNaN(dailyLimit) ||
    isNaN(minDelaySeconds) ||
    isNaN(maxDelaySeconds)
  ) {
    await ctx.reply(l.invalidNumbers);
    return;
  }

  if (minDelaySeconds > maxDelaySeconds) {
    await ctx.reply(l.invalidDelay);
    return;
  }

  const newLimits: LimitConfig = { hourlyLimit, dailyLimit, minDelaySeconds, maxDelaySeconds };
  await conversation.external(() => setDefaultLimits(newLimits));

  await ctx.reply(t(l.updated, { limits: formatLimits(newLimits) }), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text(lang.common.mainMenu, 'menu:main'),
  });
}

async function editParserSettings(
  conversation: BotConversation,
  ctx: InsideCtx,
  current: ParserSettingsConfig,
  l: ReturnType<typeof L>,
): Promise<void> {
  const currentStr = `${current.intervalSeconds} ${current.dailyRequestLimit} ${current.postsPerKeywordLimit}`;
  await ctx.reply(t(l.editParserPrompt, { current: currentStr }), { parse_mode: 'HTML' });

  const inputCtx = await conversation.waitFor('message:text');
  const parts = inputCtx.message.text.trim().split(/\s+/);

  if (parts.length !== 3) {
    await ctx.reply(l.invalidParserFormat);
    return;
  }

  const [intervalSeconds, dailyRequestLimit, postsPerKeywordLimit] = parts.map(Number);

  if (
    isNaN(intervalSeconds) ||
    isNaN(dailyRequestLimit) ||
    isNaN(postsPerKeywordLimit) ||
    intervalSeconds <= 0 ||
    dailyRequestLimit <= 0 ||
    postsPerKeywordLimit <= 0
  ) {
    await ctx.reply(l.invalidNumbers);
    return;
  }

  const newSettings: ParserSettingsConfig = {
    intervalSeconds,
    dailyRequestLimit,
    postsPerKeywordLimit,
  };

  await conversation.external(() => setDefaultParserSettings(newSettings));

  await ctx.reply(t(l.parserUpdated, { settings: formatParserSettings(newSettings) }), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text(lang.common.mainMenu, 'menu:main'),
  });
}

async function editStatusSettings(
  conversation: BotConversation,
  ctx: InsideCtx,
  current: StatusSettingsConfig,
  l: ReturnType<typeof L>,
): Promise<void> {
  await ctx.reply(t(l.editStatusPrompt, { current: current.intervalSeconds }), {
    parse_mode: 'HTML',
  });

  const inputCtx = await conversation.waitFor('message:text');
  const intervalSeconds = Number(inputCtx.message.text.trim());

  if (isNaN(intervalSeconds) || intervalSeconds <= 0) {
    await ctx.reply(l.invalidNumbers);
    return;
  }

  const newSettings: StatusSettingsConfig = { intervalSeconds };
  await conversation.external(() => setDefaultStatusSettings(newSettings));

  await ctx.reply(t(l.statusUpdated, { settings: formatStatusSettings(newSettings) }), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text(lang.common.mainMenu, 'menu:main'),
  });
}
