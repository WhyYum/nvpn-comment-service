import { eq } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { statusSettings } from '../database/schema/index.js';
import { newId } from '../database/id.js';
import { writeLog } from './logs.service.js';

export interface StatusSettingsConfig {
  intervalSeconds: number;
}

export const DEFAULT_STATUS_SETTINGS: StatusSettingsConfig = {
  intervalSeconds: 3600,
};

export async function getDefaultStatusSettings(): Promise<StatusSettingsConfig> {
  const [settings] = await getDb()
    .select()
    .from(statusSettings)
    .where(eq(statusSettings.isDefault, true))
    .limit(1);

  if (!settings) {
    return DEFAULT_STATUS_SETTINGS;
  }

  return {
    intervalSeconds: settings.intervalSeconds,
  };
}

export async function setDefaultStatusSettings(
  settings: StatusSettingsConfig,
): Promise<void> {
  const [existing] = await getDb()
    .select()
    .from(statusSettings)
    .where(eq(statusSettings.isDefault, true))
    .limit(1);

  if (existing) {
    await getDb()
      .update(statusSettings)
      .set({
        intervalSeconds: settings.intervalSeconds,
        updatedAt: new Date(),
      })
      .where(eq(statusSettings.id, existing.id));
  } else {
    await getDb().insert(statusSettings).values({
      id: newId(),
      ...settings,
      isDefault: true,
    });
  }

  await writeLog({
    level: 'INFO',
    eventType: 'STATUS_SETTINGS_UPDATED',
    message: 'Status check interval updated',
    meta: settings as unknown as Record<string, unknown>,
  });
}

export async function ensureDefaultStatusSettingsExist(): Promise<void> {
  const [existing] = await getDb()
    .select({ id: statusSettings.id })
    .from(statusSettings)
    .where(eq(statusSettings.isDefault, true))
    .limit(1);

  if (!existing) {
    await getDb().insert(statusSettings).values({
      id: newId(),
      ...DEFAULT_STATUS_SETTINGS,
      isDefault: true,
    });
  }
}
