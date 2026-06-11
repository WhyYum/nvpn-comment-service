import { Context, SessionFlavor } from 'grammy';
import { ConversationFlavor, Conversation } from '@grammyjs/conversations';

export type SessionData = Record<string, never>;

export type OutsideCtx = Context & SessionFlavor<SessionData>;

export type BotContext = ConversationFlavor<OutsideCtx>;

export type InsideCtx = Context;

export type BotConversation = Conversation<BotContext, InsideCtx>;
