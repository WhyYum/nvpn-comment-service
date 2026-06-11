import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const messageTemplates = pgTable('message_templates', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
