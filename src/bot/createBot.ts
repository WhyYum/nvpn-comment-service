import { Bot } from 'grammy';
import type { BotConfig } from 'grammy';
import type { Env } from '../config/env.js';
import { getGrammyClientOptions } from '../config/proxyAgent.js';
import type { BotContext } from './types.js';

export function createBot(env: Env): Bot<BotContext> {
  const clientOptions = getGrammyClientOptions(env);
  const config: BotConfig<BotContext> | undefined = clientOptions
    ? { client: clientOptions }
    : undefined;

  return new Bot<BotContext>(env.BOT_TOKEN, config);
}
