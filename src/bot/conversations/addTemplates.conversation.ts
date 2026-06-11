import { InlineKeyboard } from 'grammy';
import { AccountCategory } from '../../database/types.js';
import {
  getTemplates,
  addTemplate,
  deleteTemplates,
} from '../../services/templates.service.js';
import { formatAccountCategory } from '../../utils/formatters.js';
import { lang, t } from '../../core/i18n/index.js';
import type { BotConversation, InsideCtx } from '../types.js';

const L = () => lang.conversations.addTemplates;

export async function addTemplatesConversation(
  conversation: BotConversation,
  ctx: InsideCtx,
): Promise<void> {
  const l = L();

  await ctx.reply(l.selectCategory, {
    reply_markup: new InlineKeyboard()
      .text(lang.common.categoryBS, 'tmpl:cat:BS')
      .text(lang.common.categoryRegular, 'tmpl:cat:REGULAR'),
  });

  const catCtx = await conversation.waitForCallbackQuery(['tmpl:cat:BS', 'tmpl:cat:REGULAR']);
  await catCtx.answerCallbackQuery();
  const category =
    catCtx.callbackQuery.data === 'tmpl:cat:BS' ? AccountCategory.BS : AccountCategory.REGULAR;

  await showTemplatesAndWait(conversation, ctx, category);
}

async function showTemplatesAndWait(
  conversation: BotConversation,
  ctx: InsideCtx,
  category: AccountCategory,
): Promise<void> {
  const l = L();

  const existing = await conversation.external(() => getTemplates(category));
  const listText =
    existing.length === 0
      ? l.emptyList
      : existing.map((tmpl, i) => `${i + 1}. ${tmpl.text}`).join('\n\n');

  await ctx.reply(
    t(l.listHeader, { category: formatAccountCategory(category), list: listText }),
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text(lang.common.back, 'menu:main')
        .text(l.deleteBtn, 'tmpl:delete'),
    },
  );

  const inputCtx = await conversation.wait();

  if (inputCtx.callbackQuery?.data === 'tmpl:delete') {
    await inputCtx.answerCallbackQuery();
    await handleDeleteTemplates(conversation, ctx, category, existing);
    return;
  }

  if (inputCtx.callbackQuery?.data === 'menu:main') {
    await inputCtx.answerCallbackQuery();
    return;
  }

  if (!inputCtx.message?.text) {
    await ctx.reply(lang.common.notTextMessage);
    return;
  }

  const text = inputCtx.message.text.trim();
  await conversation.external(() => addTemplate(category, text));

  await ctx.reply(l.saved, {
    reply_markup: new InlineKeyboard()
      .text(l.addMoreYes, 'tmpl:addMore')
      .text(l.addMoreNo, 'menu:main'),
  });

  const moreCtx = await conversation.waitForCallbackQuery(['tmpl:addMore', 'menu:main']);
  await moreCtx.answerCallbackQuery();

  if (moreCtx.callbackQuery.data === 'tmpl:addMore') {
    await showTemplatesAndWait(conversation, ctx, category);
  }
}

async function handleDeleteTemplates(
  conversation: BotConversation,
  ctx: InsideCtx,
  category: AccountCategory,
  existing: Array<{ id: string; text: string }>,
): Promise<void> {
  const l = L();
  const listText =
    existing.length === 0
      ? l.emptyList
      : existing.map((tmpl, i) => `${i + 1}. ${tmpl.text}`).join('\n\n');

  await ctx.reply(
    t(l.deleteListHeader, { list: listText }),
    { parse_mode: 'HTML' },
  );

  const inputCtx = await conversation.waitFor('message:text');
  const lines = inputCtx.message.text.split('\n');
  const result = await conversation.external(() => deleteTemplates(category, lines));

  await ctx.reply(
    t(l.deleteResult, { deleted: result.deleted }),
    { reply_markup: new InlineKeyboard().text(lang.common.mainMenu, 'menu:main') },
  );
}
