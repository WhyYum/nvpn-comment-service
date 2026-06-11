import { eq, and, asc, inArray } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { keywords } from '../database/schema/index.js';
import { newId } from '../database/id.js';
import type { AccountCategory } from '../database/types.js';
import { writeLog } from './logs.service.js';

export async function getKeywords(category: AccountCategory) {
  return getDb()
    .select()
    .from(keywords)
    .where(eq(keywords.category, category))
    .orderBy(asc(keywords.createdAt));
}

export async function addKeywords(
  category: AccountCategory,
  texts: string[],
): Promise<{ added: number; duplicates: number }> {
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];

  const existing = await getDb()
    .select({ text: keywords.text })
    .from(keywords)
    .where(and(eq(keywords.category, category), inArray(keywords.text, unique)));

  const existingSet = new Set(existing.map((k) => k.text));
  const toAdd = unique.filter((t) => !existingSet.has(t));
  const duplicates = unique.length - toAdd.length;

  if (toAdd.length > 0) {
    await getDb()
      .insert(keywords)
      .values(toAdd.map((text) => ({ id: newId(), category, text })))
      .onConflictDoNothing({ target: [keywords.category, keywords.text] });

    await writeLog({
      level: 'INFO',
      eventType: 'KEYWORDS_ADDED',
      message: `Added ${toAdd.length} keywords to ${category}`,
      meta: { category, count: toAdd.length },
    });
  }

  return { added: toAdd.length, duplicates };
}

export async function deleteKeywords(
  category: AccountCategory,
  texts: string[],
): Promise<{ deleted: number; notFound: number }> {
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];

  const deleted = await getDb()
    .delete(keywords)
    .where(and(eq(keywords.category, category), inArray(keywords.text, unique)))
    .returning({ id: keywords.id });

  const notFound = unique.length - deleted.length;

  await writeLog({
    level: 'INFO',
    eventType: 'KEYWORDS_DELETED',
    message: `Deleted ${deleted.length} keywords from ${category}`,
    meta: { category, count: deleted.length },
  });

  return { deleted: deleted.length, notFound };
}
