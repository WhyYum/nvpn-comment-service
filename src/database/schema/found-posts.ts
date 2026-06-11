import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const foundPosts = pgTable('found_posts', {
  id: text('id').primaryKey(),
  postLink: text('post_link').notNull().unique(),
  keyword: text('keyword').notNull(),
  category: text('category').notNull(),
  status: text('status').notNull().default('PENDING'),
  senderAccountId: text('sender_account_id'),
  sentTemplateText: text('sent_template_text'),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  errorText: text('error_text'),
  retryCount: integer('retry_count').notNull().default(0),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  processingById: text('processing_by_id'),
});
