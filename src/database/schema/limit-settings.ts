import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const limitSettings = pgTable('limit_settings', {
  id: text('id').primaryKey(),
  accountId: text('account_id'),
  category: text('category'),
  hourlyLimit: integer('hourly_limit').notNull(),
  dailyLimit: integer('daily_limit').notNull(),
  minDelaySeconds: integer('min_delay_seconds').notNull(),
  maxDelaySeconds: integer('max_delay_seconds').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
