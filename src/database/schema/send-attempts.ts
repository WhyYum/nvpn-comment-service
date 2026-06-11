import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const sendAttempts = pgTable('send_attempts', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull(),
  accountId: text('account_id').notNull(),
  success: boolean('success').notNull(),
  errorText: text('error_text'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
