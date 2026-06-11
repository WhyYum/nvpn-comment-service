import 'dotenv/config';
import { bootstrapApp } from './bootstrap.js';
import { startBot } from './build-bot.js';
import { logger } from '../core/logger.js';

async function main(): Promise<void> {
  const env = await bootstrapApp();
  await startBot(env);
}

main().catch((err) => {
  console.error('Fatal bot error:', err);
  process.exit(1);
});
