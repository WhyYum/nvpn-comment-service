import { eq, and, asc, inArray } from 'drizzle-orm';
import { getDb } from '../database/context.js';
import { messageTemplates } from '../database/schema/index.js';
import { newId } from '../database/id.js';
import type { AccountCategory } from '../database/types.js';
import { writeLog } from './logs.service.js';

export async function getTemplates(category: AccountCategory) {
  return getDb()
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.category, category))
    .orderBy(asc(messageTemplates.createdAt));
}

export async function addTemplate(category: AccountCategory, text: string) {
  const [template] = await getDb()
    .insert(messageTemplates)
    .values({ id: newId(), category, text: text.trim() })
    .returning();

  await writeLog({
    level: 'INFO',
    eventType: 'TEMPLATE_ADDED',
    message: `Template added to ${category}`,
    meta: { category, templateId: template.id },
  });

  return template;
}

export async function deleteTemplates(
  category: AccountCategory,
  identifiers: string[],
): Promise<{ deleted: number }> {
  const allTemplates = await getTemplates(category);
  const toDeleteIds = new Set<string>();

  for (const ident of identifiers) {
    const trimmed = ident.trim();
    if (!trimmed) continue;

    const byIndex = parseInt(trimmed, 10);
    if (!isNaN(byIndex) && byIndex >= 1 && byIndex <= allTemplates.length) {
      const t = allTemplates[byIndex - 1];
      if (t) toDeleteIds.add(t.id);
      continue;
    }

    const byText = allTemplates.find((t) => t.text === trimmed);
    if (byText) {
      toDeleteIds.add(byText.id);
    }
  }

  if (toDeleteIds.size === 0) {
    return { deleted: 0 };
  }

  const deleted = await getDb()
    .delete(messageTemplates)
    .where(inArray(messageTemplates.id, [...toDeleteIds]))
    .returning({ id: messageTemplates.id });

  await writeLog({
    level: 'INFO',
    eventType: 'TEMPLATES_DELETED',
    message: `Deleted ${deleted.length} templates from ${category}`,
    meta: { category, count: deleted.length },
  });

  return { deleted: deleted.length };
}

export async function getRandomTemplate(category: AccountCategory) {
  const templates = await getTemplates(category);
  if (templates.length === 0) return null;
  return templates[Math.floor(Math.random() * templates.length)];
}
