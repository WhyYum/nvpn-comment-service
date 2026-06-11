import { Worker, Job } from 'bullmq';
import { AccountStatus, PostStatus, type AccountCategory } from '../database/types.js';
import { getAccountById } from '../services/accounts.service.js';
import { getFoundPostById } from '../services/posts.service.js';
import { getRedisConnection } from '../queues/index.js';
import { getClient } from '../mtproto/clientFactory.js';
import { sendComment } from '../mtproto/sender.service.js';
import { classifyTelegramError } from '../mtproto/errors.js';
import { markPostSuccess, markPostError } from '../services/posts.service.js';
import { setAccountRestricted, updateAccountActivity } from '../services/accounts.service.js';
import { notifyAccountRestriction } from '../services/notifications.service.js';
import { getRandomTemplate } from '../services/templates.service.js';
import { getDefaultLimits, checkAccountLimits } from '../services/limits.service.js';
import { writeLog } from '../services/logs.service.js';
import { createSendAttempt } from '../services/logs.viewer.service.js';
import { logger } from '../core/logger.js';
import { bootstrapApp } from '../app/bootstrap.js';
import type { Env } from '../config/env.js';

interface RetryJobData {
  postId: string;
  accountId: string;
}

function createRetryWorker(env: Env) {
  return new Worker<RetryJobData>(
    'retry',
    async (job: Job<RetryJobData>) => processRetry(env, job),
    {
      connection: getRedisConnection(env),
      concurrency: 3,
    },
  );
}

async function processRetry(env: Env, job: Job<RetryJobData>): Promise<void> {
  const { postId, accountId } = job.data;

  await writeLog({
    level: 'INFO',
    eventType: 'RETRY_START',
    message: `Retry started for post ${postId}`,
    accountId,
    meta: { postId },
  });

  const post = await getFoundPostById(postId);
  if (!post) {
    logger.warn({ postId }, 'Retry: post not found');
    return;
  }

  if (post.status === PostStatus.SUCCESS) {
    logger.info({ postId }, 'Retry: post already succeeded');
    return;
  }

  const account = await getAccountById(accountId);
  if (!account || account.status !== AccountStatus.ACTIVE) {
    await markPostError(postId, 'Account not available for retry', post.retryCount);
    await writeLog({
      level: 'WARN',
      eventType: 'RETRY_ACCOUNT_UNAVAILABLE',
      message: `Retry: account ${accountId} not active`,
      accountId,
      meta: { postId },
    });
    return;
  }

  const limits = await getDefaultLimits();
  const limitCheck = await checkAccountLimits(accountId, limits);
  if (!limitCheck.allowed) {
    await markPostError(postId, `Limit reached during retry: ${limitCheck.reason}`, post.retryCount);
    await writeLog({
      level: 'WARN',
      eventType: 'RETRY_LIMIT_REACHED',
      message: `Retry: limits not allowing send for account ${accountId}`,
      accountId,
      meta: { postId, reason: limitCheck.reason },
    });
    return;
  }

  const template = await getRandomTemplate(account.category as AccountCategory);
  if (!template) {
    await markPostError(postId, 'No templates available for retry', post.retryCount);
    return;
  }

  let client;
  try {
    client = await getClient(account);
  } catch (err) {
    const classification = classifyTelegramError(err);
    if (classification.isCritical && classification.status) {
      await setAccountRestricted(account.id, classification.status, classification.reason);
      await notifyAccountRestriction(env, account.phone, classification.reason);
    }
    await markPostError(postId, classification.reason, post.retryCount);
    return;
  }

  let sendResult: { success: boolean; errorText?: string };

  try {
    sendResult = await sendComment(client, post.postLink, template.text);
  } catch (err) {
    const classification = classifyTelegramError(err);
    if (classification.isCritical && classification.status) {
      await setAccountRestricted(account.id, classification.status, classification.reason);
      await notifyAccountRestriction(env, account.phone, classification.reason);
    }
    sendResult = { success: false, errorText: classification.reason };
  }

  await createSendAttempt({
    postId,
    accountId,
    success: sendResult.success,
    errorText: sendResult.errorText,
  });

  if (sendResult.success) {
    await markPostSuccess(postId, accountId, template.text);
    await updateAccountActivity(accountId, { sentIncrement: 1 });

    await writeLog({
      level: 'INFO',
      eventType: 'RETRY_SUCCESS',
      message: `Retry succeeded for post ${postId}`,
      accountId,
      meta: { postId },
    });
  } else {
    await updateAccountActivity(accountId, { errorsIncrement: 1 });
    await markPostError(postId, sendResult.errorText ?? 'Unknown error on retry', 2);

    await writeLog({
      level: 'ERROR',
      eventType: 'RETRY_FAILED',
      message: `Retry failed for post ${postId}: ${sendResult.errorText}`,
      accountId,
      meta: { postId, errorText: sendResult.errorText },
    });
  }
}

async function main(): Promise<void> {
  const env = await bootstrapApp();
  const worker = createRetryWorker(env);

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Retry job failed');
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Retry job completed');
  });

  logger.info('Retry worker started');
}

main().catch((err) => {
  console.error('Retry worker fatal error:', err);
  process.exit(1);
});
