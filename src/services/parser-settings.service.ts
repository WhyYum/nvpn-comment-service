import { eq } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { parserSettings } from '../database/schema/index.js';
import { newId } from '../database/id.js';
import { writeLog } from './logs.service.js';

export interface ParserSettingsConfig {
  intervalSeconds: number;
  dailyRequestLimit: number;
  postsPerKeywordLimit: number;
}

export const DEFAULT_PARSER_SETTINGS: ParserSettingsConfig = {
  intervalSeconds: 4500,
  dailyRequestLimit: 10,
  postsPerKeywordLimit: 250,
};

export async function getDefaultParserSettings(): Promise<ParserSettingsConfig> {
  const [settings] = await getDb()
    .select()
    .from(parserSettings)
    .where(eq(parserSettings.isDefault, true))
    .limit(1);

  if (!settings) {
    return DEFAULT_PARSER_SETTINGS;
  }

  return {
    intervalSeconds: settings.intervalSeconds,
    dailyRequestLimit: settings.dailyRequestLimit,
    postsPerKeywordLimit: settings.postsPerKeywordLimit,
  };
}

export async function setDefaultParserSettings(
  settings: ParserSettingsConfig,
): Promise<void> {
  const [existing] = await getDb()
    .select()
    .from(parserSettings)
    .where(eq(parserSettings.isDefault, true))
    .limit(1);

  if (existing) {
    await getDb()
      .update(parserSettings)
      .set({
        intervalSeconds: settings.intervalSeconds,
        dailyRequestLimit: settings.dailyRequestLimit,
        postsPerKeywordLimit: settings.postsPerKeywordLimit,
        updatedAt: new Date(),
      })
      .where(eq(parserSettings.id, existing.id));
  } else {
    await getDb().insert(parserSettings).values({
      id: newId(),
      ...settings,
      isDefault: true,
    });
  }

  await writeLog({
    level: 'INFO',
    eventType: 'PARSER_SETTINGS_UPDATED',
    message: 'Parser settings updated',
    meta: settings as unknown as Record<string, unknown>,
  });
}

export async function ensureDefaultParserSettingsExist(): Promise<void> {
  const [existing] = await getDb()
    .select({ id: parserSettings.id })
    .from(parserSettings)
    .where(eq(parserSettings.isDefault, true))
    .limit(1);

  if (!existing) {
    await getDb().insert(parserSettings).values({
      id: newId(),
      ...DEFAULT_PARSER_SETTINGS,
      isDefault: true,
    });
  }
}
