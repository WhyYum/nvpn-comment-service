import { NextFunction } from 'grammy';
import { getAdminIds, loadEnv } from '../../config/env.js';
import { lang } from '../../core/i18n/index.js';
import type { BotContext } from '../types.js';

const adminIds = getAdminIds(loadEnv());

export async function adminOnly(ctx: BotContext, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !adminIds.includes(userId)) {
    await ctx.reply(lang.access.denied);
    return;
  }
  await next();
}
