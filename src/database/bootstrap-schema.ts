import postgres from 'postgres';
import type { Env } from '../config/env.js';
import { logger } from '../core/logger.js';

const TABLE_DEFINITIONS: Array<{ name: string; sql: string }> = [
  {
    name: 'telegram_accounts',
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_accounts (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE NOT NULL,
        api_id INTEGER NOT NULL,
        api_hash_encrypted TEXT NOT NULL,
        session_encrypted TEXT NOT NULL,
        role VARCHAR(32) NOT NULL,
        category VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
        is_premium BOOLEAN NOT NULL DEFAULT false,
        status_reason TEXT,
        added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_activity_at TIMESTAMPTZ,
        sent_total INTEGER NOT NULL DEFAULT 0,
        errors_total INTEGER NOT NULL DEFAULT 0,
        parser_requests_today INTEGER NOT NULL DEFAULT 0,
        parser_requests_date TIMESTAMPTZ
      )
    `,
  },
  {
    name: 'parser_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS parser_settings (
        id TEXT PRIMARY KEY,
        interval_seconds INTEGER NOT NULL,
        daily_request_limit INTEGER NOT NULL,
        posts_per_keyword_limit INTEGER NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
  },
  {
    name: 'status_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS status_settings (
        id TEXT PRIMARY KEY,
        interval_seconds INTEGER NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
  },
  {
    name: 'parser_scheduler',
    sql: `
      CREATE TABLE IF NOT EXISTS parser_scheduler (
        id TEXT PRIMARY KEY,
        category VARCHAR(32) NOT NULL DEFAULT 'BS',
        keyword_index INTEGER NOT NULL DEFAULT 0
      )
    `,
  },
  {
    name: 'keywords',
    sql: `
      CREATE TABLE IF NOT EXISTS keywords (
        id TEXT PRIMARY KEY,
        category VARCHAR(32) NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
  },
  {
    name: 'message_templates',
    sql: `
      CREATE TABLE IF NOT EXISTS message_templates (
        id TEXT PRIMARY KEY,
        category VARCHAR(32) NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
  },
  {
    name: 'found_posts',
    sql: `
      CREATE TABLE IF NOT EXISTS found_posts (
        id TEXT PRIMARY KEY,
        post_link TEXT UNIQUE NOT NULL,
        keyword TEXT NOT NULL,
        category VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        sender_account_id TEXT REFERENCES telegram_accounts(id) ON DELETE SET NULL,
        sent_template_text TEXT,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sent_at TIMESTAMPTZ,
        error_text TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        locked_at TIMESTAMPTZ,
        processing_by_id TEXT
      )
    `,
  },
  {
    name: 'send_attempts',
    sql: `
      CREATE TABLE IF NOT EXISTS send_attempts (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL REFERENCES found_posts(id) ON DELETE RESTRICT,
        account_id TEXT NOT NULL REFERENCES telegram_accounts(id) ON DELETE RESTRICT,
        success BOOLEAN NOT NULL,
        error_text TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
  },
  {
    name: 'limit_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS limit_settings (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        category VARCHAR(32),
        hourly_limit INTEGER NOT NULL,
        daily_limit INTEGER NOT NULL,
        min_delay_seconds INTEGER NOT NULL,
        max_delay_seconds INTEGER NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
  },
  {
    name: 'log_entries',
    sql: `
      CREATE TABLE IF NOT EXISTS log_entries (
        id TEXT PRIMARY KEY,
        level VARCHAR(16) NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        account_id TEXT REFERENCES telegram_accounts(id) ON DELETE SET NULL,
        meta JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
  },
];

const INDEX_DEFINITIONS: Array<{ sql: string }> = [
  { sql: 'CREATE UNIQUE INDEX IF NOT EXISTS keywords_category_text_idx ON keywords (category, text)' },
];

const COLUMN_MIGRATIONS: Array<{ table: string; column: string; definition: string }> = [
  {
    table: 'telegram_accounts',
    column: 'parser_requests_today',
    definition: 'INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: 'telegram_accounts',
    column: 'parser_requests_date',
    definition: 'TIMESTAMPTZ',
  },
];

async function columnExists(
  sql: postgres.Sql,
  table: string,
  column: string,
): Promise<boolean> {
  const result = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `;
  return result.length > 0;
}

async function addColumnIfMissing(
  sql: postgres.Sql,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const exists = await columnExists(sql, table, column);
  if (!exists) {
    await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    logger.info({ table, column }, 'Added missing column');
  }
}

export async function bootstrapSchema(env: Env): Promise<void> {
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    for (const { name, sql: createSql } of TABLE_DEFINITIONS) {
      await sql.unsafe(createSql.trim());
      logger.debug({ table: name }, 'Table ensured');
    }

    for (const { sql: indexSql } of INDEX_DEFINITIONS) {
      await sql.unsafe(indexSql);
    }

    for (const { table, column, definition } of COLUMN_MIGRATIONS) {
      await addColumnIfMissing(sql, table, column, definition);
    }

    await sql.unsafe(`
      INSERT INTO parser_scheduler (id, category, keyword_index)
      VALUES ('main', 'BS', 0)
      ON CONFLICT (id) DO NOTHING
    `);

    logger.info('Database schema bootstrap completed');
  } finally {
    await sql.end();
  }
}
