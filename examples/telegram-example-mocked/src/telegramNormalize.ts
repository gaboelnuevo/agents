import type { NormalizedInboundMessage } from "@agent-runtime/conversation-gateway";
import type { TelegramMessage, TelegramUpdate } from "./telegramTypes.js";

/** Stable thread id for a private chat (extend for groups if needed). */
export function conversationKeyFromTelegramChat(chatId: number): string {
  return `telegram:chat:${chatId}`;
}

/**
 * Provider-unique id for idempotency (retries reuse the same key).
 * Telegram `message_id` is unique per chat, not globally.
 */
export function externalMessageIdFromTelegram(msg: TelegramMessage): string {
  return `telegram:${msg.chat.id}:${msg.message_id}`;
}

/** Map a text message into the gateway DTO. Skip non-text in your real webhook. */
export function telegramMessageToNormalized(msg: TelegramMessage): NormalizedInboundMessage {
  const text = msg.text ?? "";
  return {
    conversationKey: conversationKeyFromTelegramChat(msg.chat.id),
    text,
    externalMessageId: externalMessageIdFromTelegram(msg),
    receivedAt: new Date(msg.date * 1000).toISOString(),
    metadata: { telegram: { chatId: msg.chat.id, messageId: msg.message_id } },
  };
}

export function telegramUpdateToMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message ?? update.edited_message;
}
