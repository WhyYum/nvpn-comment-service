import { InlineKeyboard } from 'grammy';
import { getSystemStats } from '../../services/stats.service.js';
import { lang } from '../../core/i18n/index.js';

export async function buildStatsMessage(): Promise<{
  text: string;
  keyboard: InlineKeyboard;
}> {
  const stats = await getSystemStats();
  const text = formatStats(stats);
  const keyboard = new InlineKeyboard().text(lang.common.mainMenu, 'menu:main');
  return { text, keyboard };
}

function formatStats(stats: {
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
}): string {
  return lang.stats.format
    .replace('%parsers%', String(stats.parsers))
    .replace('%senders%', String(stats.senders))
    .replace('%premiumAccounts%', String(stats.premiumAccounts))
    .replace('%spamBlockAccounts%', String(stats.spamBlockAccounts))
    .replace('%totalPosts%', String(stats.totalPosts))
    .replace('%pendingPosts%', String(stats.pendingPosts))
    .replace('%successPosts%', String(stats.successPosts))
    .replace('%errorPosts%', String(stats.errorPosts))
    .replace('%sentToday%', String(stats.sentToday))
    .replace('%sentThisWeek%', String(stats.sentThisWeek))
    .replace('%sentThisMonth%', String(stats.sentThisMonth));
}
