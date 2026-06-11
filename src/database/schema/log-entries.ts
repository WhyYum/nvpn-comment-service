import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const logEntries = pgTable('log_entries', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  eventType: text('event_type').notNull(),
  message: text('message').notNull(),
  accountId: text('account_id'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
