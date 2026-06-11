import { InlineKeyboard } from 'grammy';
import {
  getDefaultLimits,
  setDefaultLimits,
  LimitConfig,
} from '../../services/limits.service.js';
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

export async function limitsConversation(
  conversation: BotConversation,
  ctx: InsideCtx,
): Promise<void> {
  const l = L();
  const current = await conversation.external(() => getDefaultLimits());

  await ctx.reply(`${formatLimits(current)}\n\n${l.changePrompt}`, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard()
      .text(l.editBtn, 'limits:edit')
      .text(lang.common.back, 'menu:main'),
  });

  const actionCtx = await conversation.waitForCallbackQuery(['limits:edit', 'menu:main']);
  await actionCtx.answerCallbackQuery();

  if (actionCtx.callbackQuery.data === 'menu:main') return;

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
