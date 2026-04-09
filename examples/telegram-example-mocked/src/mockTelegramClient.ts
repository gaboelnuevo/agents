/**
 * Records outbound "sent" messages instead of calling api.telegram.org.
 * In production, replace with fetch(`https://api.telegram.org/bot${token}/sendMessage`, …).
 */
export interface MockSentMessage {
  chatId: number;
  text: string;
  runId?: string;
}

export class MockTelegramClient {
  readonly outbox: MockSentMessage[] = [];

  async sendMessage(chatId: number, text: string, opts?: { runId?: string }): Promise<void> {
    this.outbox.push({ chatId, text, runId: opts?.runId });
  }
}

/** Parse `telegram:chat:<id>` from ConversationGateway's conversationKey. */
export function chatIdFromConversationKey(conversationKey: string): number {
  const m = /^telegram:chat:(-?\d+)$/.exec(conversationKey);
  if (!m) {
    throw new Error(`Unexpected conversationKey (expected telegram:chat:<id>): ${conversationKey}`);
  }
  return Number(m[1]);
}
