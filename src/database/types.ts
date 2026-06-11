export const AccountRole = {
  PARSER: 'PARSER',
  SENDER: 'SENDER',
} as const;
export type AccountRole = (typeof AccountRole)[keyof typeof AccountRole];

export const AccountCategory = {
  BS: 'BS',
  REGULAR: 'REGULAR',
} as const;
export type AccountCategory = (typeof AccountCategory)[keyof typeof AccountCategory];

export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  STOPPED: 'STOPPED',
  SPAM_BLOCK: 'SPAM_BLOCK',
  FLOOD_WAIT: 'FLOOD_WAIT',
  AUTH_ERROR: 'AUTH_ERROR',
  BANNED: 'BANNED',
  NEEDS_CHECK: 'NEEDS_CHECK',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const PostStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
} as const;
export type PostStatus = (typeof PostStatus)[keyof typeof PostStatus];

export const LogLevel = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];
