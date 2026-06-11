import { desc } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { AccountStatus } from '../../database/types.js';
import { lang, t } from '../../core/i18n/index.js';
import { startOfDay } from '../../utils/dates.js';
import {
  formatAccountRole,
  formatAccountCategory,
  formatAccountStatus,
} from '../../utils/formatters.js';
import { formatDateTime } from '../../utils/dates.js';
import { getDb } from '../../database/context.js';
import { telegramAccounts } from '../../database/schema/index.js';
import {
  countFoundPostsToday,
  countSendAttemptsToday,
} from '../../services/logs.viewer.service.js';

export async function buildAccountsMessage(): Promise<{
  text: string;
  keyboard: InlineKeyboard;
}> {
  const m = lang.menu.accounts;
  const accounts = await getDb()
    .select()
    .from(telegramAccounts)
    .orderBy(desc(telegramAccounts.addedAt));

  if (accounts.length === 0) {
    return {
      text: m.empty,
      keyboard: new InlineKeyboard().text(lang.common.mainMenu, 'menu:main'),
    };
  }

  const today = startOfDay();

  const accountsWithStats = await Promise.all(
    accounts.map(async (acc) => {
      const [sentToday, errorsToday] = await Promise.all([
        countFoundPostsToday(acc.id, today),
        countSendAttemptsToday(acc.id, today),
      ]);
      return { ...acc, sentToday, errorsToday };
    }),
  );

  const lines = accountsWithStats.map((acc) =>
    t(lang.accountCard, {
      phone: acc.phone,
      role: formatAccountRole(acc.role),
      category: formatAccountCategory(acc.category),
      status: formatAccountStatus(acc.status),
      premium: acc.isPremium ? 'Да' : 'Нет',
      sentToday: acc.sentToday,
      errorsToday: acc.errorsToday,
      lastActivity: acc.lastActivityAt ? formatDateTime(acc.lastActivityAt) : 'Нет',
    }),
  );

  const text = lines.join('\n\n─────────────────\n\n');

  const keyboard = new InlineKeyboard();
  for (const acc of accountsWithStats) {
    if (acc.status === AccountStatus.ACTIVE) {
      keyboard.text(t(m.btnStop, { phone: acc.phone }), `acc:stop:${acc.id}`);
    } else if (acc.status === AccountStatus.STOPPED) {
      keyboard.text(t(m.btnStart, { phone: acc.phone }), `acc:start:${acc.id}`);
    }
    keyboard
      .text(m.btnCheck, `acc:check:${acc.id}`)
      .text(m.btnDelete, `acc:delete:${acc.id}`)
      .row();
  }
  keyboard.text(lang.common.mainMenu, 'menu:main');

  return { text, keyboard };
}
