import { InlineKeyboard } from 'grammy';
import { lang } from '../../core/i18n/index.js';
import type { LogLevel } from '../../database/types.js';

export interface LogsFilter {
  level?: LogLevel;
}

export function buildLogsMenuMessage(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const m = lang.menu.logs;

  const keyboard = new InlineKeyboard()
    .text(m.filterError, 'logs:filter:ERROR')
    .text(m.filterWarn, 'logs:filter:WARN')
    .row()
    .text(m.filterAll, 'logs:filter:ALL')
    .row()
    .text(lang.common.mainMenu, 'menu:main');

  return { text: m.hint, keyboard };
}

export function logsFilterLabel(filterKey: string): string {
  const m = lang.menu.logs;
  if (filterKey === 'ERROR') return m.filterError;
  if (filterKey === 'WARN') return m.filterWarn;
  return m.filterAll;
}

export function buildLogsFileName(filterKey: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `logs_${filterKey.toLowerCase()}_${stamp}.txt`;
}
