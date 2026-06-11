import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const keywords = pgTable(
  'keywords',
  {
    id: text('id').primaryKey(),
    category: text('category').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('keywords_category_text_idx').on(table.category, table.text)],
);
