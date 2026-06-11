import type { Env } from '../config/env.js';
import { createBot } from '../bot/createBot.js';
import { getAdminIds } from '../config/env.js';
import { logger } from '../core/logger.js';
import { lang, t } from '../core/i18n/index.js';

let notificationBot: ReturnType<typeof createBot> | null = null;
let notificationEnv: Env | null = null;

export function getNotificationBot(env: Env) {
  if (!notificationBot || notificationEnv !== env) {
    notificationBot = createBot(env);
    notificationEnv = env;
  }
  return notificationBot;
}

export async function notifyAdmins(env: Env, message: string): Promise<void> {
  const bot = getNotificationBot(env);
  for (const adminId of getAdminIds(env)) {
    try {
      await bot.api.sendMessage(adminId, message, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err, adminId }, 'Failed to send notification to admin');
    }
  }
}

export async function notifyAccountRestriction(
  env: Env,
  phone: string,
  reason: string,
): Promise<void> {
  const text = t(lang.notifications.restriction, { phone, reason });
  await notifyAdmins(env, text);
}
