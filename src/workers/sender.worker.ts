import { AccountRole, type AccountCategory } from '../database/types.js';
import { getActiveAccounts } from '../services/accounts.service.js';
import { getClient } from '../mtproto/clientFactory.js';
import { sendComment } from '../mtproto/sender.service.js';
import { classifyTelegramError } from '../mtproto/errors.js';
import {
  lockPostForProcessing,
  markPostSuccess,
  markPostPending,
  markPostError,
  getPendingPostsForCategory,
  unlockStalePosts,
} from '../services/posts.service.js';
import { setAccountRestricted, updateAccountActivity } from '../services/accounts.service.js';
import { notifyAccountRestriction } from '../services/notifications.service.js';
import { getRandomTemplate } from '../services/templates.service.js';
import { getDefaultLimits, checkAccountLimits } from '../services/limits.service.js';
import { writeLog } from '../services/logs.service.js';
import { createSendAttempt } from '../services/logs.viewer.service.js';
import { logger } from '../core/logger.js';
import { delay } from '../utils/delay.js';
import { randomDelayMs } from '../utils/random.js';
import { createRetryQueue } from '../queues/index.js';
import { bootstrapApp } from '../app/bootstrap.js';
import type { Env } from '../config/env.js';

const SENDER_CYCLE_INTERVAL_MS = 30 * 1000;

async function runSenderCycle(env: Env, retryQueue: ReturnType<typeof createRetryQueue>): Promise<void> {
  await unlockStalePosts(10);

  const accounts = await getActiveAccounts(AccountRole.SENDER);
  const limits = await getDefaultLimits();

  for (const account of accounts) {
    const limitCheck = await checkAccountLimits(account.id, limits);
    if (!limitCheck.allowed) {
      logger.info({ accountId: account.id, reason: limitCheck.reason }, 'Account skipped due to limits');
      continue;
    }

    const posts = await getPendingPostsForCategory(account.category as AccountCategory, 5);
    if (posts.length === 0) continue;

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
          level: 'ERROR',
          eventType: 'SENDER_CLIENT_ERROR',
          message: `Failed to connect sender client: ${classification.reason}`,
          accountId: account.id,
        });
      }
      continue;
    }

    for (const post of posts) {
      const limitCheck2 = await checkAccountLimits(account.id, limits);
      if (!limitCheck2.allowed) break;

      const locked = await lockPostForProcessing(post.id, account.id);
      if (!locked) continue;

      const template = await getRandomTemplate(account.category as AccountCategory);
      if (!template) {
        await markPostPending(post.id, post.retryCount);
        await writeLog({
          level: 'WARN',
          eventType: 'SENDER_NO_TEMPLATE',
          message: `No templates available for category ${account.category}`,
          accountId: account.id,
        });
        continue;
      }

      await writeLog({
        level: 'INFO',
        eventType: 'SENDER_ATTEMPT',
        message: `Attempting to send to: ${post.postLink}`,
        accountId: account.id,
        meta: { postId: post.id, postLink: post.postLink },
      });

      let sendResult: { success: boolean; errorText?: string };

      try {
        sendResult = await sendComment(client, post.postLink, template.text);
      } catch (err) {
        const classification = classifyTelegramError(err);

        if (classification.isCritical && classification.status) {
          await setAccountRestricted(account.id, classification.status, classification.reason);
          await notifyAccountRestriction(env, account.phone, classification.reason);
          await markPostPending(post.id, post.retryCount);
          break;
        }

        sendResult = {
          success: false,
          errorText: classification.reason,
        };
      }

      if (sendResult.success) {
        await markPostSuccess(post.id, account.id, template.text);
        await updateAccountActivity(account.id, { sentIncrement: 1 });

        await createSendAttempt({
          postId: post.id,
          accountId: account.id,
          success: true,
        });

        await writeLog({
          level: 'INFO',
          eventType: 'SENDER_SUCCESS',
          message: `Message sent successfully to ${post.postLink}`,
          accountId: account.id,
          meta: { postId: post.id },
        });

        const delayMs = randomDelayMs(limits.minDelaySeconds, limits.maxDelaySeconds);
        await delay(delayMs);
      } else {
        await updateAccountActivity(account.id, { errorsIncrement: 1 });

        await createSendAttempt({
          postId: post.id,
          accountId: account.id,
          success: false,
          errorText: sendResult.errorText,
        });

        await writeLog({
          level: 'ERROR',
          eventType: 'SENDER_ERROR',
          message: `Send failed for ${post.postLink}: ${sendResult.errorText}`,
          accountId: account.id,
          meta: { postId: post.id, errorText: sendResult.errorText },
        });

        if (post.retryCount === 0) {
          await markPostPending(post.id, 1);

          await retryQueue.add(
            'retry-send',
            { postId: post.id, accountId: account.id },
            { delay: 5 * 60 * 1000 },
          );

          await writeLog({
            level: 'INFO',
            eventType: 'SENDER_RETRY_SCHEDULED',
            message: `Retry scheduled for post ${post.id} in 5 minutes`,
            accountId: account.id,
            meta: { postId: post.id },
          });
        } else {
          await markPostError(post.id, sendResult.errorText ?? 'Unknown error', 2);
        }
      }
    }
  }
}

async function startSenderWorker(env: Env): Promise<void> {
  const retryQueue = createRetryQueue(env);
  logger.info('Sender worker starting');

  while (true) {
    try {
      await runSenderCycle(env, retryQueue);
    } catch (err) {
      logger.error({ err }, 'Sender cycle failed');
    }
    await delay(SENDER_CYCLE_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  const env = await bootstrapApp();
  await startSenderWorker(env);
}

main().catch((err) => {
  console.error('Sender worker fatal error:', err);
  process.exit(1);
});
