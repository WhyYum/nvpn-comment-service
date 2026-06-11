import { AccountStatus } from '../database/types.js';
import { getAllAccountsRaw, updateAccountStatus } from '../services/accounts.service.js';
import { getClient } from '../mtproto/clientFactory.js';
import { checkAccountStatus } from '../mtproto/status.service.js';
import { classifyTelegramError } from '../mtproto/errors.js';
import { writeLog } from '../services/logs.service.js';
import { notifyAdmins } from '../services/notifications.service.js';
import { formatAccountStatus } from '../utils/formatters.js';
import { logger } from '../core/logger.js';
import { delay } from '../utils/delay.js';
import { bootstrapApp } from '../app/bootstrap.js';
import type { Env } from '../config/env.js';

interface StatusReport {
  total: number;
  active: number;
  spamBlock: number;
  floodWait: number;
  authError: number;
  banned: number;
  needsCheck: number;
  stopped: number;
  premium: number;
}

async function runStatusCheck(env: Env): Promise<void> {
  logger.info('Status check cycle started');

  const accounts = await getAllAccountsRaw();
  logger.info({ count: accounts.length }, 'Checking account statuses');

  const report: StatusReport = {
    total: accounts.length,
    active: 0,
    spamBlock: 0,
    floodWait: 0,
    authError: 0,
    banned: 0,
    needsCheck: 0,
    stopped: 0,
    premium: 0,
  };

  for (const account of accounts) {
    if (account.status === AccountStatus.STOPPED) {
      report.stopped++;
      continue;
    }

    let statusResult: { status: string; isPremium: boolean; statusReason?: string };

    try {
      const client = await getClient(account);
      statusResult = await checkAccountStatus(client);
    } catch (err) {
      const classification = classifyTelegramError(err);
      statusResult = {
        status: classification.status ?? AccountStatus.NEEDS_CHECK,
        isPremium: account.isPremium,
        statusReason: classification.reason,
      };
    }

    await updateAccountStatus(account.id, {
      status: statusResult.status as AccountStatus,
      isPremium: statusResult.isPremium,
      statusReason: statusResult.statusReason ?? null,
    });

    await writeLog({
      level: 'INFO',
      eventType: 'STATUS_CHECKED',
      message: `Account status: ${formatAccountStatus(statusResult.status)}`,
      accountId: account.id,
      meta: { status: statusResult.status, isPremium: statusResult.isPremium },
    });

    switch (statusResult.status) {
      case AccountStatus.ACTIVE:
        report.active++;
        break;
      case AccountStatus.SPAM_BLOCK:
        report.spamBlock++;
        break;
      case AccountStatus.FLOOD_WAIT:
        report.floodWait++;
        break;
      case AccountStatus.AUTH_ERROR:
        report.authError++;
        break;
      case AccountStatus.BANNED:
        report.banned++;
        break;
      case AccountStatus.NEEDS_CHECK:
        report.needsCheck++;
        break;
      case AccountStatus.STOPPED:
        report.stopped++;
        break;
    }

    if (statusResult.isPremium) report.premium++;

    await delay(1000);
  }

  const reportText =
    `<b>Проверка статусов завершена.</b>\n\n` +
    `Всего аккаунтов: ${report.total}\n` +
    `Активны: ${report.active}\n` +
    `Остановлены: ${report.stopped}\n` +
    `SpamBlock: ${report.spamBlock}\n` +
    `FloodWait: ${report.floodWait}\n` +
    `Ошибка авторизации: ${report.authError}\n` +
    `Заблокированы: ${report.banned}\n` +
    `Требуют проверки: ${report.needsCheck}\n` +
    `Premium: ${report.premium}`;

  await notifyAdmins(env, reportText);
  logger.info({ report }, 'Status check cycle completed');
}

async function startStatusWorker(env: Env): Promise<void> {
  const statusIntervalMs = env.STATUS_CHECK_INTERVAL_SECONDS * 1000;
  logger.info({ interval: env.STATUS_CHECK_INTERVAL_SECONDS }, 'Status worker starting');

  while (true) {
    try {
      await runStatusCheck(env);
    } catch (err) {
      logger.error({ err }, 'Status check cycle failed');
    }
    await delay(statusIntervalMs);
  }
}

async function main(): Promise<void> {
  const env = await bootstrapApp();
  await startStatusWorker(env);
}

main().catch((err) => {
  console.error('Status worker fatal error:', err);
  process.exit(1);
});
