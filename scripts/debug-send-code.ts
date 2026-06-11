/**
 * Диагностика auth.sendCode без бота.
 *
 * PowerShell:
 *   cd vpn_ad_bot_service
 *   npx tsx scripts/debug-send-code.ts <API_ID> <API_HASH> <+PHONE> [--sms]
 *
 * Пример:
 *   npx tsx scripts/debug-send-code.ts 12345678 abcdef0123456789abcdef01234567 +79991234567
 *   npx tsx scripts/debug-send-code.ts 12345678 abcdef... +79991234567 --sms
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { loadEnv, getTelegramProxy } from '../src/config/env.js';
import {
  invokeAuthSendCode,
  diagnosticsToLogMeta,
  formatTelegramRpcError,
  getClientDcId,
} from '../src/mtproto/authDiagnostics.js';

config({ path: resolve(process.cwd(), '.env') });

const args = process.argv.slice(2).filter((a) => a !== '--sms');
const forceSMS = process.argv.includes('--sms');

const apiIdRaw = args[0];
const apiHash = args[1];
const phone = args[2];

if (!apiIdRaw || !apiHash || !phone) {
  console.error('Usage: npx tsx scripts/debug-send-code.ts <API_ID> <API_HASH> <+PHONE> [--sms]');
  process.exit(1);
}

const apiId = parseInt(apiIdRaw, 10);
if (isNaN(apiId)) {
  console.error('API_ID must be a number');
  process.exit(1);
}

if (!phone.startsWith('+')) {
  console.error('Phone must start with +');
  process.exit(1);
}

async function main(): Promise<void> {
  const proxy = getTelegramProxy(loadEnv());
  console.log('Proxy:', proxy ? `${proxy.ip}:${proxy.port}` : 'disabled');

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
    retryDelay: 2000,
    autoReconnect: false,
    useWSS: false,
    ...(proxy ? { proxy } : {}),
  });

  try {
    console.log('Connecting...');
    await client.connect();
    console.log('Connected, DC:', getClientDcId(client) ?? '?');

    console.log('Invoking auth.sendCode, forceSMS=', forceSMS);
    const { phoneCodeHash, diagnostics } = await invokeAuthSendCode(
      client,
      apiId,
      apiHash,
      phone,
      forceSMS,
    );

    console.log('\n=== OK: Telegram accepted the request ===');
    console.log('phoneCodeHash length:', phoneCodeHash.length);
    console.log('Summary:', diagnostics.summaryRu);
    console.log('Hint:', diagnostics.hintRu);
    console.log('Details JSON:', JSON.stringify(diagnosticsToLogMeta(diagnostics), null, 2));
    if (diagnostics.smsResendUnavailable) {
      console.log(
        '\n=== SMS unavailable (SEND_CODE_UNAVAILABLE) ===',
      );
      console.log(
        'First SendCode succeeded (app delivery). ResendCode for SMS was rejected.',
      );
      console.log('Use the code from Telegram app chat "Telegram". Do not use --sms for this number.');
    } else if (diagnostics.codeType === 'auth.SentCodeTypeApp') {
      console.log('\nOpen Telegram app chat "Telegram", not SMS.');
    }
  } catch (err) {
    console.error('\n=== FAILED ===');
    console.error(formatTelegramRpcError(err));
    console.error('\nCommon errors:');
    console.error('  PHONE_NUMBER_INVALID — wrong format');
    console.error('  PHONE_NUMBER_FLOOD / FLOOD_WAIT — too many attempts, wait');
    console.error('  API_ID_INVALID — wrong api_id/hash pair from my.telegram.org');
    console.error('  SEND_CODE_UNAVAILABLE — SMS not allowed; use app chat "Telegram" (run without --sms)');
    console.error('  AUTH_RESTART — retry (script handles automatically once)');
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

main();
