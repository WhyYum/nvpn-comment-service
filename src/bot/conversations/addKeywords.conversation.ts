import { InlineKeyboard } from 'grammy';
import { AccountCategory } from '../../database/types.js';
import {
  getKeywords,
  addKeywords,
  deleteKeywords,
} from '../../services/keywords.service.js';
import { formatAccountCategory } from '../../utils/formatters.js';
import { lang, t } from '../../core/i18n/index.js';
import type { BotConversation, InsideCtx } from '../types.js';

const L = () => lang.conversations.addKeywords;

export async function addKeywordsConversation(
  conversation: BotConversation,
  ctx: InsideCtx,
): Promise<void> {
  const l = L();

  await ctx.reply(l.selectCategory, {
    reply_markup: new InlineKeyboard()
      .text(lang.common.categoryBS, 'kw:cat:BS')
      .text(lang.common.categoryRegular, 'kw:cat:REGULAR'),
  });

  const catCtx = await conversation.waitForCallbackQuery(['kw:cat:BS', 'kw:cat:REGULAR']);
  await catCtx.answerCallbackQuery();
  const category =
    catCtx.callbackQuery.data === 'kw:cat:BS' ? AccountCategory.BS : AccountCategory.REGULAR;

  const existing = await conversation.external(() => getKeywords(category));
  const listText =
    existing.length === 0
      ? l.emptyList
      : existing.map((k, i) => `${i + 1}. ${k.text}`).join('\n');

  await ctx.reply(
    t(l.listHeader, { category: formatAccountCategory(category), list: listText }),
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text(lang.common.back, 'menu:main')
        .text(l.deleteBtn, 'kw:delete'),
    },
  );

  const inputCtx = await conversation.wait();

  if (inputCtx.callbackQuery?.data === 'kw:delete') {
    await inputCtx.answerCallbackQuery();
    await handleDeleteKeywords(conversation, ctx, category, existing);
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

  const lines = inputCtx.message.text.split('\n');
  const result = await conversation.external(() => addKeywords(category, lines));

  await ctx.reply(
    t(l.addResult, { added: result.added, duplicates: result.duplicates }),
    { reply_markup: new InlineKeyboard().text(lang.common.mainMenu, 'menu:main') },
  );
}

async function handleDeleteKeywords(
  conversation: BotConversation,
  ctx: InsideCtx,
  category: AccountCategory,
  existing: Array<{ text: string }>,
): Promise<void> {
  const l = L();
  const listText =
    existing.length === 0
      ? l.emptyList
      : existing.map((k, i) => `${i + 1}. ${k.text}`).join('\n');

  await ctx.reply(
    t(l.deleteListHeader, { list: listText }),
    { parse_mode: 'HTML' },
  );

  const inputCtx = await conversation.waitFor('message:text');
  const lines = inputCtx.message.text.split('\n');
  const result = await conversation.external(() => deleteKeywords(category, lines));

  await ctx.reply(
    t(l.deleteResult, { deleted: result.deleted, notFound: result.notFound }),
    { reply_markup: new InlineKeyboard().text(lang.common.mainMenu, 'menu:main') },
  );
}
