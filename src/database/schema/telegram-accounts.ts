import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const telegramAccounts = pgTable('telegram_accounts', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull().unique(),
  apiId: integer('api_id').notNull(),
  apiHashEncrypted: text('api_hash_encrypted').notNull(),
  sessionEncrypted: text('session_encrypted').notNull(),
  role: text('role').notNull(),
  category: text('category').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  isPremium: boolean('is_premium').notNull().default(false),
  statusReason: text('status_reason'),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  sentTotal: integer('sent_total').notNull().default(0),
  errorsTotal: integer('errors_total').notNull().default(0),
});
