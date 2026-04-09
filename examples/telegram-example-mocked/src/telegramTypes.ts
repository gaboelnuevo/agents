/**
 * Minimal Telegram Bot API shapes (private chat text only) — enough for the mock.
 * @see https://core.telegram.org/bots/api#message
 */

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}
