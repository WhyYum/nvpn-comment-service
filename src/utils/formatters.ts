import { AccountStatus, AccountRole, AccountCategory, PostStatus } from '../database/types.js';
import { lang } from '../core/i18n/index.js';

export function formatAccountStatus(status: string): string {
  return lang.accountStatus[status] ?? status;
}

export function formatAccountRole(role: string): string {
  return lang.accountRole[role] ?? role;
}

export function formatAccountCategory(category: string): string {
  return lang.accountCategory[category] ?? category;
}

export function formatPostStatus(status: string): string {
  return lang.postStatus[status] ?? status;
}

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export {
  AccountStatus,
  AccountRole,
  AccountCategory,
  PostStatus,
};
