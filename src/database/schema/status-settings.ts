import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const statusSettings = pgTable('status_settings', {
  id: text('id').primaryKey(),
  intervalSeconds: integer('interval_seconds').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
