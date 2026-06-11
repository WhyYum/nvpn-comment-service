import { eq, and, gte, count } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { limitSettings, foundPosts } from '../database/schema/index.js';
import { newId } from '../database/id.js';
import { PostStatus } from '../database/types.js';
import { writeLog } from './logs.service.js';
import { startOfDay, startOfHour } from '../utils/dates.js';

export interface LimitConfig {
  hourlyLimit: number;
  dailyLimit: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
}

const DEFAULT_LIMITS: LimitConfig = {
  hourlyLimit: 20,
  dailyLimit: 100,
  minDelaySeconds: 30,
  maxDelaySeconds: 120,
};

export async function getDefaultLimits(): Promise<LimitConfig> {
  const [settings] = await getDb()
    .select()
    .from(limitSettings)
    .where(eq(limitSettings.isDefault, true))
    .limit(1);

  if (!settings) return DEFAULT_LIMITS;

  return {
    hourlyLimit: settings.hourlyLimit,
    dailyLimit: settings.dailyLimit,
    minDelaySeconds: settings.minDelaySeconds,
    maxDelaySeconds: settings.maxDelaySeconds,
  };
}

export async function setDefaultLimits(limits: LimitConfig): Promise<void> {
  const [existing] = await getDb()
    .select()
    .from(limitSettings)
    .where(eq(limitSettings.isDefault, true))
    .limit(1);

  if (existing) {
    await getDb()
      .update(limitSettings)
      .set({
        hourlyLimit: limits.hourlyLimit,
        dailyLimit: limits.dailyLimit,
        minDelaySeconds: limits.minDelaySeconds,
        maxDelaySeconds: limits.maxDelaySeconds,
        updatedAt: new Date(),
      })
      .where(eq(limitSettings.id, existing.id));
  } else {
    await getDb().insert(limitSettings).values({
      id: newId(),
      ...limits,
      isDefault: true,
    });
  }

  await writeLog({
    level: 'INFO',
    eventType: 'LIMITS_UPDATED',
    message: 'Default limits updated',
    meta: limits as unknown as Record<string, unknown>,
  });
}

export async function checkAccountLimits(
  accountId: string,
  limits: LimitConfig,
): Promise<{ allowed: boolean; reason?: string }> {
  const hourStart = startOfHour();
  const dayStart = startOfDay();

  const hourlyWhere = and(
    eq(foundPosts.senderAccountId, accountId),
    eq(foundPosts.status, PostStatus.SUCCESS),
    gte(foundPosts.sentAt, hourStart),
  );

  const dailyWhere = and(
    eq(foundPosts.senderAccountId, accountId),
    eq(foundPosts.status, PostStatus.SUCCESS),
    gte(foundPosts.sentAt, dayStart),
  );

  const [[hourlyRow], [dailyRow]] = await Promise.all([
    getDb().select({ count: count() }).from(foundPosts).where(hourlyWhere),
    getDb().select({ count: count() }).from(foundPosts).where(dailyWhere),
  ]);

  const hourlyCount = hourlyRow?.count ?? 0;
  const dailyCount = dailyRow?.count ?? 0;

  if (hourlyCount >= limits.hourlyLimit) {
    return {
      allowed: false,
      reason: `Hourly limit reached (${hourlyCount}/${limits.hourlyLimit})`,
    };
  }

  if (dailyCount >= limits.dailyLimit) {
    return {
      allowed: false,
      reason: `Daily limit reached (${dailyCount}/${limits.dailyLimit})`,
    };
  }

  return { allowed: true };
}

export async function ensureDefaultLimitsExist(): Promise<void> {
  const [existing] = await getDb()
    .select({ id: limitSettings.id })
    .from(limitSettings)
    .where(eq(limitSettings.isDefault, true))
    .limit(1);

  if (!existing) {
    await getDb().insert(limitSettings).values({
      id: newId(),
      ...DEFAULT_LIMITS,
      isDefault: true,
    });
  }
}
