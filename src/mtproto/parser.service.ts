import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { normalizePostLink } from '../utils/normalizePostLink.js';
import { logger } from '../core/logger.js';
import { formatTelegramRpcError } from './authDiagnostics.js';
import { delay } from '../utils/delay.js';

export interface ParsedPost {
  postLink: string;
  keyword: string;
  channelTitle: string;
}

/** global_posts — channels.searchPosts (вкладка «Посты» / глобальный поиск); hashtag — только по тегу */
export type PublicSearchMode = 'global_posts' | 'hashtag';

export interface PublicSearchResult {
  posts: ParsedPost[];
  mode: PublicSearchMode;
  modesUsed: string[];
  floodNote?: string;
}

export async function searchGlobal(
  client: TelegramClient,
  keyword: string,
  limit = 200,
): Promise<ParsedPost[]> {
  const result = await searchPublicChannelPosts(client, keyword, limit);
  return result.posts;
}

/**
 * Глобальный поиск постов в публичных каналах — channels.searchPosts (как вкладка «Посты»).
 * НЕ messages.searchGlobal — тот ищет по чатам вашего аккаунта.
 */
export async function searchPublicChannelPosts(
  client: TelegramClient,
  keyword: string,
  limit = 200,
): Promise<PublicSearchResult> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return { posts: [], mode: 'global_posts', modesUsed: [] };
  }

  logger.info({ keyword: trimmed, limit }, 'channels.searchPosts (global public posts)');

  try {
    const byQuery = await invokeSearchPostsByQuery(client, trimmed, limit);
    return {
      posts: byQuery.posts,
      mode: 'global_posts',
      modesUsed: ['channels.searchPosts:query'],
      floodNote: byQuery.floodNote,
    };
  } catch (queryErr: unknown) {
    const queryMsg = formatTelegramRpcError(queryErr);
    const tag = extractHashtagFallback(trimmed);

    if (!tag) {
      throw new Error(
        `Глобальный поиск постов не удался: ${queryMsg}. Для фраз используйте #хештег или обновите MTProto-клиент.`,
      );
    }

    logger.warn(
      { keyword: trimmed, error: queryMsg, hashtag: tag },
      'searchPosts query failed, fallback to hashtag',
    );

    await delay(1500);
    const byTag = await invokeSearchPostsByHashtag(client, tag, trimmed, limit);
    return {
      posts: byTag.posts,
      mode: 'hashtag',
      modesUsed: ['channels.searchPosts:hashtag'],
      floodNote: byTag.floodNote,
    };
  }
}

function extractHashtagFallback(keyword: string): string | null {
  const t = keyword.trim();
  if (t.startsWith('#')) {
    const tag = t.slice(1).replace(/\s+/g, '');
    return tag || null;
  }
  if (!/\s/.test(t)) {
    return t;
  }
  return null;
}

async function invokeSearchPostsByQuery(
  client: TelegramClient,
  query: string,
  limit: number,
): Promise<{ posts: ParsedPost[]; floodNote?: string }> {
  const response = await client.invoke(
    new Api.channels.SearchPosts({
      query,
      offsetRate: 0,
      offsetPeer: new Api.InputPeerEmpty(),
      offsetId: 0,
      limit,
    }),
  );

  const parsed = await parseMessagesResponse(client, response, query);
  logger.info({ query, found: parsed.posts.length }, 'searchPosts query completed');
  return parsed;
}

async function invokeSearchPostsByHashtag(
  client: TelegramClient,
  hashtag: string,
  originalKeyword: string,
  limit: number,
): Promise<{ posts: ParsedPost[]; floodNote?: string }> {
  const response = await client.invoke(
    new Api.channels.SearchPosts({
      hashtag,
      offsetRate: 0,
      offsetPeer: new Api.InputPeerEmpty(),
      offsetId: 0,
      limit,
    }),
  );

  const parsed = await parseMessagesResponse(client, response, originalKeyword);
  logger.info({ hashtag, found: parsed.posts.length }, 'searchPosts hashtag completed');
  return parsed;
}

async function parseMessagesResponse(
  client: TelegramClient,
  response: Api.messages.TypeMessages,
  keyword: string,
): Promise<{ posts: ParsedPost[]; floodNote?: string }> {
  const posts: ParsedPost[] = [];
  const seenLinks = new Set<string>();

  let floodNote: string | undefined;
  if (response instanceof Api.messages.MessagesSlice) {
    const slice = response as Api.messages.MessagesSlice & {
      searchFlood?: { remaining?: number };
    };
    if (slice.searchFlood && typeof slice.searchFlood.remaining === 'number') {
      floodNote = `Осталось бесплатных текстовых поисков: ${slice.searchFlood.remaining}`;
    }
  }

  if (
    !(response instanceof Api.messages.MessagesSlice) &&
    !(response instanceof Api.messages.Messages) &&
    !(response instanceof Api.messages.ChannelMessages)
  ) {
    return { posts, floodNote };
  }

  const messages = 'messages' in response ? response.messages : [];

  for (const msg of messages) {
    if (!(msg instanceof Api.Message)) continue;
    if (!msg.peerId || !msg.id) continue;
    if (!(msg.peerId instanceof Api.PeerChannel)) continue;

    const channelId = String(msg.peerId.channelId);
    let username: string | null = null;
    let channelTitle = '';

    try {
      const chat = await client.getEntity(msg.peerId);
      if (chat instanceof Api.Channel) {
        username = chat.username ?? null;
        channelTitle = chat.title ?? '';
      }
    } catch {
      // публичный канал может быть не в кэше — ссылка всё равно строится
    }

    const postLink = normalizePostLink(username, channelId, msg.id);
    if (!postLink || seenLinks.has(postLink)) continue;

    seenLinks.add(postLink);
    posts.push({ postLink, keyword, channelTitle });
  }

  return { posts, floodNote };
}
