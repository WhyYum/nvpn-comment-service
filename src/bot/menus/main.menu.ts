import { InlineKeyboard } from 'grammy';
import { lang } from '../../core/i18n/index.js';

export function buildMainMenu(): InlineKeyboard {
  const m = lang.menu.main;
  return new InlineKeyboard()
    .text(m.accounts, 'menu:accounts').row()
    .text(m.addAccount, 'conv:addAccount').row()
    .text(m.addKeywords, 'conv:addKeywords').row()
    .text(m.addTemplates, 'conv:addTemplates').row()
    .text(m.stats, 'menu:stats').row()
    .text(m.logs, 'menu:logs').row()
    .text(m.limits, 'conv:limits').row()
    .text(m.checkStatuses, 'action:checkStatuses');
}
