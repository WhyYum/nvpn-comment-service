import { InlineKeyboard, InputFile } from 'grammy';
import { AccountRole, AccountCategory } from '../../database/types.js';
import {
  beginAuthSession,
  resendAuthCodeSms,
  signInAuthSession,
  signInAuthSessionPassword,
  finalizeAuthSession,
  cancelAuthSession,
} from '../../mtproto/auth.service.js';
import {
  startQrAuthWorker,
  getQrAuthStatus,
  submitQrAuthPassword,
  isPhoneCodeInvalidError,
} from '../../mtproto/authQr.service.js';
import { createAccount } from '../../services/accounts.service.js';
import { writeLog } from '../../services/logs.service.js';
import {
  formatAccountRole,
  formatAccountCategory,
  formatAccountStatus,
} from '../../utils/formatters.js';
import { loadEnv } from '../../config/env.js';
import { diagnosticsToLogMeta } from '../../mtproto/authDiagnostics.js';
import { qrPngForLoginUrl } from '../../utils/qrLogin.js';
import { delay } from '../../utils/delay.js';
import { lang, t } from '../../core/i18n/index.js';
import type { BotConversation, InsideCtx } from '../types.js';

const L = () => lang.conversations.addAccount;

export async function addAccountConversation(
  conversation: BotConversation,
  ctx: InsideCtx,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply(lang.common.notTextMessage);
    return;
  }

  const l = L();

  try {
    await runAddAccountFlow(conversation, ctx, userId, l);
  } finally {
    await conversation.external(() => cancelAuthSession(userId));
  }
}

async function runAddAccountFlow(
  conversation: BotConversation,
  ctx: InsideCtx,
  userId: number,
  l: ReturnType<typeof L>,
): Promise<void> {
  await ctx.reply(l.step1, {
    reply_markup: new InlineKeyboard()
      .text(l.roleParser, 'role:PARSER')
      .text(l.roleSender, 'role:SENDER'),
  });

  const roleCtx = await conversation.waitForCallbackQuery(['role:PARSER', 'role:SENDER']);
  await roleCtx.answerCallbackQuery();
  const role =
    roleCtx.callbackQuery.data === 'role:PARSER' ? AccountRole.PARSER : AccountRole.SENDER;

  await ctx.reply(l.step2, {
    reply_markup: new InlineKeyboard()
      .text(lang.common.categoryBS, 'cat:BS')
      .text(lang.common.categoryRegular, 'cat:REGULAR'),
  });

  const catCtx = await conversation.waitForCallbackQuery(['cat:BS', 'cat:REGULAR']);
  await catCtx.answerCallbackQuery();
  const category =
    catCtx.callbackQuery.data === 'cat:BS' ? AccountCategory.BS : AccountCategory.REGULAR;

  await ctx.reply(l.step3);
  const apiIdMsg = await conversation.waitFor('message:text');
  const apiId = parseInt(apiIdMsg.message.text.trim(), 10);
  await deleteSensitiveUserMessage(apiIdMsg);
  if (isNaN(apiId)) {
    await ctx.reply(l.invalidApiId);
    return;
  }

  await ctx.reply(l.step4);
  const apiHashMsg = await conversation.waitFor('message:text');
  const apiHash = apiHashMsg.message.text.trim();
  await deleteSensitiveUserMessage(apiHashMsg);
  if (!apiHash || apiHash.length < 10) {
    await ctx.reply(l.invalidApiHash);
    return;
  }

  await apiHashMsg.reply(l.chooseAuth, {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard()
      .text(l.authByQr, 'auth:qr')
      .row()
      .text(l.authByPhone, 'auth:phone'),
  });

  const authMethodCtx = await conversation.waitForCallbackQuery(['auth:phone', 'auth:qr']);
  await authMethodCtx.answerCallbackQuery();

  const useQr = authMethodCtx.callbackQuery.data === 'auth:qr';

  const authOk = useQr
    ? await runQrAuthFlow(conversation, ctx, userId, apiId, apiHash, l)
    : await runPhoneAuthFlow(conversation, ctx, userId, apiId, apiHash, l);

  if (!authOk) {
    return;
  }

  await ctx.reply(l.checkingAccount);

  let authResult: Awaited<ReturnType<typeof finalizeAuthSession>>;

  try {
    authResult = await conversation.external(() => finalizeAuthSession(userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(t(l.healthError, { error: msg }));
    await conversation.external(() =>
      writeLog({
        level: 'ERROR',
        eventType: 'AUTH_HEALTH_CHECK_FAILED',
        message: 'Account health check failed after auth',
      }),
    );
    return;
  }

  if (authResult.isRestricted) {
    await ctx.reply(
      t(l.restricted, { reason: authResult.restrictionReason ?? 'неизвестно' }),
    );
  }

  const account = await conversation.external(() =>
    createAccount({
      phone: authResult.phone,
      apiId: authResult.apiId,
      apiHash: authResult.apiHash,
      sessionString: authResult.sessionString,
      role,
      category,
      isPremium: authResult.isPremium,
    }),
  );

  await ctx.reply(
    t(l.success, {
      phone: account.phone,
      role: formatAccountRole(account.role),
      category: formatAccountCategory(account.category),
      premium: account.isPremium ? l.premiumYes : l.premiumNo,
      status: formatAccountStatus(account.status),
    }),
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text(lang.common.mainMenu, 'menu:main'),
    },
  );
}

async function runPhoneAuthFlow(
  conversation: BotConversation,
  ctx: InsideCtx,
  userId: number,
  apiId: number,
  apiHash: string,
  l: ReturnType<typeof L>,
): Promise<boolean> {
  await ctx.reply(l.step5);
  const phoneMsg = await conversation.waitFor('message:text');
  const phone = phoneMsg.message.text.trim();
  await deleteSensitiveUserMessage(phoneMsg);
  if (!phone.startsWith('+')) {
    await ctx.reply(l.invalidPhone);
    return false;
  }

  await ctx.reply(l.sendingCode);

  let codeSentViaApp = true;

  try {
    const sent = await conversation.external(() =>
      beginAuthSession(userId, apiId, apiHash, phone),
    );
    codeSentViaApp = sent.isCodeViaApp;
    await ctx.reply(
      sent.isCodeViaApp ? l.codeSentApp : t(l.codeSentSms, { phone }),
      { parse_mode: 'HTML' },
    );
    await ctx.reply(t(l.codeDeliveryHint, { hint: sent.diagnosticsHint }), {
      parse_mode: 'HTML',
    });
    await ctx.reply(t(l.codeDeliverySummary, { summary: sent.diagnosticsSummary }), {
      parse_mode: 'HTML',
    });
    if (loadEnv().AUTH_DEBUG && sent.diagnostics) {
      await ctx.reply(
        `<pre>${escapeHtml(JSON.stringify(diagnosticsToLogMeta(sent.diagnostics), null, 2))}</pre>`,
        { parse_mode: 'HTML' },
      );
    }
    await conversation.external(() =>
      writeLog({
        level: 'INFO',
        eventType: 'AUTH_CODE_SENT',
        message: `Auth code sent: ${sent.diagnosticsSummary}`,
        meta: {
          phone: phone.slice(0, 4) + '***',
          ...(sent.diagnostics ? diagnosticsToLogMeta(sent.diagnostics) : {}),
        },
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(t(l.codeRequestError, { error: msg }));
    return false;
  }

  await ctx.reply(l.enterCode, {
    reply_markup: codeSentViaApp
      ? new InlineKeyboard().text(l.resendSms, 'auth:resend_sms')
      : undefined,
  });

  const code = await waitForAuthCode(conversation, ctx, userId, phone, l);
  if (!code) {
    return false;
  }

  try {
    const signInResult = await conversation.external(() =>
      signInAuthSession(userId, code),
    );
    if (signInResult.needPassword) {
      const hint = signInResult.passwordHint
        ? t(l.twoFaHintSuffix, { hint: signInResult.passwordHint })
        : '';
      await ctx.reply(t(l.enter2fa, { hint }));
      const pwMsg = await conversation.waitFor('message:text');
      const password = pwMsg.message.text.trim();
      await deleteSensitiveUserMessage(pwMsg);
      await conversation.external(() =>
        signInAuthSessionPassword(userId, password),
      );
    }
    return true;
  } catch (err) {
    if (isPhoneCodeInvalidError(err)) {
      await ctx.reply(l.codeWrongSession, { parse_mode: 'HTML' });
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(t(l.signInError, { error: msg }));
    }
    await conversation.external(() =>
      writeLog({
        level: 'ERROR',
        eventType: 'AUTH_SIGN_IN_FAILED',
        message: 'Sign in failed',
        meta: { phone: phone.slice(0, 4) + '***' },
      }),
    );
    return false;
  }
}

async function runQrAuthFlow(
  conversation: BotConversation,
  ctx: InsideCtx,
  userId: number,
  apiId: number,
  apiHash: string,
  l: ReturnType<typeof L>,
): Promise<boolean> {
  await ctx.reply(l.qrStarting);

  await conversation.external(() => startQrAuthWorker(userId, apiId, apiHash));

  let lastUrl = '';
  let polls = 0;
  const maxPolls = 40;

  while (polls < maxPolls) {
    polls += 1;
    const status = await conversation.external(() => getQrAuthStatus(userId));

    if (!status) {
      await ctx.reply(l.qrTimeout);
      return false;
    }

    if (status.status === 'error') {
      await ctx.reply(t(l.qrError, { error: status.error ?? 'unknown' }));
      return false;
    }

    if (status.status === 'done') {
      return true;
    }

    if (status.status === 'password') {
      const hint = status.passwordHint
        ? t(l.twoFaHintSuffix, { hint: status.passwordHint })
        : '';
      await ctx.reply(t(l.enter2fa, { hint }));
      const pwMsg = await conversation.waitFor('message:text');
      const password = pwMsg.message.text.trim();
      await deleteSensitiveUserMessage(pwMsg);
      try {
        await conversation.external(() =>
          submitQrAuthPassword(userId, password),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.reply(t(l.passwordError, { error: msg }));
        return false;
      }

      for (let i = 0; i < 30; i++) {
        await conversation.external(() => delay(2000));
        const afterPw = await conversation.external(() => getQrAuthStatus(userId));
        if (afterPw?.status === 'done') {
          return true;
        }
        if (afterPw?.status === 'error') {
          await ctx.reply(t(l.qrError, { error: afterPw.error ?? 'unknown' }));
          return false;
        }
      }
      await ctx.reply(l.qrTimeout);
      return false;
    }

    if (status.loginUrl && status.loginUrl !== lastUrl) {
      lastUrl = status.loginUrl;
      const png = await conversation.external(() => qrPngForLoginUrl(status.loginUrl));
      await ctx.replyWithPhoto(new InputFile(png), {
        caption: l.qrScan,
        parse_mode: 'HTML',
      });
      await ctx.reply(t(l.qrLink, { url: status.loginUrl }), { parse_mode: 'HTML' });
    } else if (polls === 1) {
      await ctx.reply(l.qrWaiting);
    }

    await conversation.external(() => delay(3000));
  }

  await ctx.reply(l.qrTimeout);
  return false;
}

async function waitForAuthCode(
  conversation: BotConversation,
  ctx: InsideCtx,
  userId: number,
  phone: string,
  l: ReturnType<typeof L>,
): Promise<string | null> {
  while (true) {
    const update = await conversation.wait();

    if (update.callbackQuery?.data === 'auth:resend_sms') {
      await update.answerCallbackQuery();
      try {
        const resent = await conversation.external(() => resendAuthCodeSms(userId));
        if (resent.smsResendUnavailable) {
          await ctx.reply(l.codeSmsUnavailable, { parse_mode: 'HTML' });
        } else {
          await ctx.reply(t(l.codeResentSms, { phone }), { parse_mode: 'HTML' });
        }
        await ctx.reply(t(l.codeDeliverySummary, { summary: resent.diagnosticsSummary }), {
          parse_mode: 'HTML',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.reply(t(l.codeRequestError, { error: msg }));
      }
      continue;
    }

    const text = update.message?.text?.trim();
    if (text) {
      await deleteSensitiveUserMessage(update);
      return text;
    }

    await ctx.reply(lang.common.notTextMessage);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function deleteSensitiveUserMessage(msgCtx: InsideCtx): Promise<void> {
  try {
    await msgCtx.deleteMessage();
  } catch {
    // Сообщение уже удалено, слишком старое или нет прав у бота
  }
}
