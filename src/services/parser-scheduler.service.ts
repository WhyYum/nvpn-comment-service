import { eq } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { parserScheduler } from '../database/schema/index.js';
import { AccountCategory, AccountRole } from '../database/types.js';
import { getActiveAccounts } from './accounts.service.js';
import { getKeywords } from './keywords.service.js';
import {
  getParserRemainingRequests,
  pickParserAccount,
  type ParserAccountUsage,
} from './parser-limits.service.js';
import type { ParserSettingsConfig } from './parser-settings.service.js';

const SCHEDULER_ID = 'main';
const CATEGORY_ORDER: AccountCategory[] = [AccountCategory.BS, AccountCategory.REGULAR];

export interface ParserTask {
  account: ParserAccountUsage & {
    apiId: number;
    apiHashEncrypted: string;
    sessionEncrypted: string;
  };
  keyword: { id: string; text: string };
  category: AccountCategory;
  remainingRequests: number;
}

interface SchedulerState {
  category: AccountCategory;
  keywordIndex: number;
}

export async function resolveNextParserTask(
  settings: ParserSettingsConfig,
): Promise<ParserTask | null> {
  const parsers = await getActiveAccounts(AccountRole.PARSER);
  if (parsers.length === 0) {
    return null;
  }

  const parserCategories = new Set(
    parsers.map((account) => account.category as AccountCategory),
  );

  let state = await getSchedulerState();
  const maxAttempts = 32;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!parserCategories.has(state.category)) {
      state = {
        category: nextCategory(state.category),
        keywordIndex: 0,
      };
      continue;
    }

    const keywords = await getKeywords(state.category);
    if (keywords.length === 0) {
      const next = advanceSchedulerState(state, 0);
      state = next;
      await saveSchedulerState(next);
      continue;
    }

    if (state.keywordIndex >= keywords.length) {
      state = {
        category: nextCategory(state.category),
        keywordIndex: 0,
      };
      await saveSchedulerState(state);
      continue;
    }

    const keyword = keywords[state.keywordIndex];
    const category = state.category;
    const categoryParsers = parsers.filter((account) => account.category === category) as Array<
      ParserAccountUsage & {
        apiId: number;
        apiHashEncrypted: string;
        sessionEncrypted: string;
      }
    >;

    const account = pickParserAccount(categoryParsers, settings.dailyRequestLimit);
    const nextState = advanceSchedulerState(state, keywords.length);
    await saveSchedulerState(nextState);
    state = nextState;

    if (!account) {
      return null;
    }

    return {
      account,
      keyword,
      category,
      remainingRequests: getParserRemainingRequests(account, settings.dailyRequestLimit),
    };
  }

  return null;
}

function advanceSchedulerState(state: SchedulerState, keywordCount: number): SchedulerState {
  if (keywordCount <= 0) {
    return {
      category: nextCategory(state.category),
      keywordIndex: 0,
    };
  }

  const nextIndex = state.keywordIndex + 1;
  if (nextIndex >= keywordCount) {
    return {
      category: nextCategory(state.category),
      keywordIndex: 0,
    };
  }

  return {
    category: state.category,
    keywordIndex: nextIndex,
  };
}

function nextCategory(current: AccountCategory): AccountCategory {
  const index = CATEGORY_ORDER.indexOf(current);
  const nextIndex = index === -1 ? 0 : (index + 1) % CATEGORY_ORDER.length;
  return CATEGORY_ORDER[nextIndex];
}

async function getSchedulerState(): Promise<SchedulerState> {
  const [row] = await getDb()
    .select()
    .from(parserScheduler)
    .where(eq(parserScheduler.id, SCHEDULER_ID))
    .limit(1);

  if (!row) {
    const initial: SchedulerState = {
      category: AccountCategory.BS,
      keywordIndex: 0,
    };
    await saveSchedulerState(initial);
    return initial;
  }

  return {
    category: row.category as AccountCategory,
    keywordIndex: row.keywordIndex,
  };
}

async function saveSchedulerState(state: SchedulerState): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: parserScheduler.id })
    .from(parserScheduler)
    .where(eq(parserScheduler.id, SCHEDULER_ID))
    .limit(1);

  if (existing) {
    await db
      .update(parserScheduler)
      .set({
        category: state.category,
        keywordIndex: state.keywordIndex,
      })
      .where(eq(parserScheduler.id, SCHEDULER_ID));
    return;
  }

  await db.insert(parserScheduler).values({
    id: SCHEDULER_ID,
    category: state.category,
    keywordIndex: state.keywordIndex,
  });
}

export async function ensureParserSchedulerExists(): Promise<void> {
  await getSchedulerState();
}
