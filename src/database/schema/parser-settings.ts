import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const parserSettings = pgTable('parser_settings', {
  id: text('id').primaryKey(),
  intervalSeconds: integer('interval_seconds').notNull(),
  dailyRequestLimit: integer('daily_request_limit').notNull(),
  postsPerKeywordLimit: integer('posts_per_keyword_limit').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
