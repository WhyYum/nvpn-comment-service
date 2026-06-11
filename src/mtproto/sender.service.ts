import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { logger } from '../core/logger.js';
import { delay } from '../utils/delay.js';
import { formatTelegramRpcError } from './authDiagnostics.js';

export interface SendCommentResult {
  success: boolean;
  errorText?: string;
}

interface DiscussionContext {
  postLink: string;
  sendPeer: Api.TypeInputPeer;
  replyToMsgId: number;
  discussionChat: Api.Channel | null;
}

export async function sendComment(
  client: TelegramClient,
  postLink: string,
  text: string,
): Promise<SendCommentResult> {
  const parsed = parsePostLink(postLink);
  if (!parsed) {
    return {
      success: false,
      errorText: `Cannot parse post link: ${postLink}`,
    };
  }

  try {
    const ctx = await buildDiscussionContext(client, parsed, postLink);
    if ('errorText' in ctx) {
      return { success: false, errorText: ctx.errorText };
    }

    const membershipError = await ensureCanSendInDiscussion(client, ctx.discussionChat);
    if (membershipError) {
      return { success: false, errorText: membershipError };
    }

    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await sendDiscussionReply(client, ctx, text);
        logger.info({ postLink }, 'Comment sent successfully');
        return { success: true };
      } catch (err: unknown) {
        const errorText = formatTelegramRpcError(err);
        const upper = errorText.toUpperCase();

        if (
          upper.includes('CHAT_COMMENTS_DISABLED') ||
          upper.includes('MSG_ID_INVALID') ||
          upper.includes('CHANNEL_INVALID')
        ) {
          return {
            success: false,
            errorText: `Comments unavailable: ${errorText}`,
          };
        }

        if (attempt === 0 && isJoinRequiredError(upper) && ctx.discussionChat) {
          logger.info(
            { postLink, error: errorText },
            'Send requires channel membership, joining discussion chat',
          );

          const joinError = await joinDiscussionChannel(client, ctx.discussionChat);
          if (joinError) {
            return { success: false, errorText: joinError };
          }

          await delay(ctx.discussionChat.joinRequest ? 3000 : 1500);
          continue;
        }

        return { success: false, errorText };
      }
    }

    return { success: false, errorText: 'Send failed after join retry' };
  } catch (err: unknown) {
    const errorText = formatTelegramRpcError(err);
    const upper = errorText.toUpperCase();

    if (
      upper.includes('CHAT_COMMENTS_DISABLED') ||
      upper.includes('MSG_ID_INVALID') ||
      upper.includes('CHANNEL_INVALID')
    ) {
      return {
        success: false,
        errorText: `Comments unavailable: ${errorText}`,
      };
    }

    throw err;
  }
}

async function buildDiscussionContext(
  client: TelegramClient,
  parsed: ParsedPostLink,
  postLink: string,
): Promise<DiscussionContext | { errorText: string }> {
  const { peer, messageId } = await resolvePostPeer(client, parsed);

  const discussionResult = await client.invoke(
    new Api.messages.GetDiscussionMessage({
      peer,
      msgId: messageId,
    }),
  );

  if (!(discussionResult instanceof Api.messages.DiscussionMessage)) {
    return { errorText: 'No linked discussion chat available for this post' };
  }

  const replyTo = discussionResult.messages[0];
  if (!replyTo || !('id' in replyTo)) {
    return { errorText: 'Could not find discussion message to reply to' };
  }

  const discussionChat = pickDiscussionChannel(discussionResult.chats);
  const sendPeer = discussionChat
    ? channelToInputPeer(discussionChat)
    : peer;

  return {
    postLink,
    sendPeer,
    replyToMsgId: replyTo.id,
    discussionChat,
  };
}

async function sendDiscussionReply(
  client: TelegramClient,
  ctx: DiscussionContext,
  text: string,
): Promise<void> {
  await client.invoke(
    new Api.messages.SendMessage({
      peer: ctx.sendPeer,
      replyTo: new Api.InputReplyToMessage({
        replyToMsgId: ctx.replyToMsgId,
      }),
      message: text,
      randomId: bigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
      noWebpage: true,
    }),
  );
}

/**
 * Проверяет, можно ли писать в чат обсуждений без гостевого режима; при необходимости вступает.
 */
async function ensureCanSendInDiscussion(
  client: TelegramClient,
  discussionChat: Api.Channel | null,
): Promise<string | null> {
  if (!discussionChat) {
    return null;
  }

  const status = await getDiscussionMembershipStatus(client, discussionChat);

  if (status === 'member') {
    return null;
  }

  if (status === 'banned') {
    return 'Account is banned from sending in this discussion chat';
  }

  if (status === 'private') {
    return 'Discussion chat is private and not accessible';
  }

  const needsJoin =
    status === 'not_member' ||
    discussionChat.joinToSend ||
    discussionChat.joinRequest ||
    discussionChat.left;

  if (!needsJoin) {
    return null;
  }

  logger.info(
    {
      channelId: discussionChat.id?.toString(),
      joinToSend: discussionChat.joinToSend,
      joinRequest: discussionChat.joinRequest,
    },
    'Joining discussion chat before send',
  );

  return joinDiscussionChannel(client, discussionChat);
}

async function getDiscussionMembershipStatus(
  client: TelegramClient,
  channel: Api.Channel,
): Promise<'member' | 'not_member' | 'banned' | 'private'> {
  if (!channel.accessHash) {
    return channel.left ? 'not_member' : 'member';
  }

  try {
    const result = await client.invoke(
      new Api.channels.GetParticipant({
        channel: channelToInputPeer(channel),
        participant: new Api.InputPeerSelf(),
      }),
    );

    const participant = result.participant;

    if (participant instanceof Api.ChannelParticipantBanned) {
      if (participant.bannedRights?.sendMessages) {
        return 'banned';
      }
      return 'not_member';
    }

    if (participant instanceof Api.ChannelParticipantLeft) {
      return 'not_member';
    }

    return 'member';
  } catch (err: unknown) {
    const msg = formatTelegramRpcError(err).toUpperCase();

    if (
      msg.includes('USER_NOT_PARTICIPANT') ||
      msg.includes('PARTICIPANT_ID_INVALID')
    ) {
      return 'not_member';
    }

    if (msg.includes('CHANNEL_PRIVATE') || msg.includes('CHANNEL_INVALID')) {
      return 'private';
    }

    if (channel.left) {
      return 'not_member';
    }

    throw err;
  }
}

async function joinDiscussionChannel(
  client: TelegramClient,
  channel: Api.Channel,
): Promise<string | null> {
  if (!channel.accessHash) {
    return 'Cannot join discussion chat: missing access hash';
  }

  const inputChannel = channelToInputPeer(channel);

  try {
    await client.invoke(
      new Api.channels.JoinChannel({
        channel: inputChannel,
      }),
    );

    logger.info(
      {
        channelId: channel.id?.toString(),
        joinRequest: channel.joinRequest,
      },
      channel.joinRequest
        ? 'Join request sent to discussion chat'
        : 'Joined discussion chat',
    );

    if (channel.joinRequest) {
      await delay(3000);
      const status = await getDiscussionMembershipStatus(client, channel);
      if (status !== 'member') {
        return 'Join request sent; waiting for admin approval to send messages';
      }
    }

    return null;
  } catch (err: unknown) {
    const msg = formatTelegramRpcError(err);
    const upper = msg.toUpperCase();

    if (upper.includes('USER_ALREADY_PARTICIPANT')) {
      return null;
    }

    if (upper.includes('INVITE_REQUEST_SENT')) {
      await delay(3000);
      return null;
    }

    return `Failed to join discussion chat: ${msg}`;
  }
}

function isJoinRequiredError(upperMessage: string): boolean {
  return (
    upperMessage.includes('CHAT_GUEST_SEND_FORBIDDEN') ||
    upperMessage.includes('USER_NOT_PARTICIPANT') ||
    upperMessage.includes('CHAT_WRITE_FORBIDDEN') ||
    upperMessage.includes('CHAT_SEND_PLAIN_FORBIDDEN')
  );
}

function pickDiscussionChannel(chats: Api.TypeChat[]): Api.Channel | null {
  for (const chat of chats) {
    if (chat instanceof Api.Channel) {
      return chat;
    }
  }
  return null;
}

function channelToInputPeer(channel: Api.Channel): Api.InputPeerChannel {
  return new Api.InputPeerChannel({
    channelId: channel.id,
    accessHash: channel.accessHash!,
  });
}

interface ParsedPostLink {
  username?: string;
  channelId?: string;
  messageId: number;
}

function parsePostLink(postLink: string): ParsedPostLink | null {
  const usernameMatch = postLink.match(/t\.me\/([^/]+)\/(\d+)/);
  if (usernameMatch) {
    return {
      username: usernameMatch[1],
      messageId: parseInt(usernameMatch[2], 10),
    };
  }

  const cMatch = postLink.match(/t\.me\/c\/(\d+)\/(\d+)/);
  if (cMatch) {
    return {
      channelId: cMatch[1],
      messageId: parseInt(cMatch[2], 10),
    };
  }

  return null;
}

async function resolvePostPeer(
  client: TelegramClient,
  parsed: ParsedPostLink,
): Promise<{ peer: Api.TypeInputPeer; messageId: number }> {
  if (parsed.username) {
    const entity = await client.getInputEntity(parsed.username);
    return { peer: entity as Api.TypeInputPeer, messageId: parsed.messageId };
  }

  if (parsed.channelId) {
    const channelEntity = await client.getInputEntity(
      new Api.PeerChannel({ channelId: bigInt(parsed.channelId) }),
    );
    return { peer: channelEntity as Api.TypeInputPeer, messageId: parsed.messageId };
  }

  throw new Error('Cannot resolve post peer');
}
