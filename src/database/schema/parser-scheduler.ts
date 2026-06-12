import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const parserScheduler = pgTable('parser_scheduler', {
  id: text('id').primaryKey(),
  category: text('category').notNull().default('BS'),
  keywordIndex: integer('keyword_index').notNull().default(0),
});
