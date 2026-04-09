/**
 * Mock Telegram pipeline: fake webhook updates → ConversationGateway → mock sendMessage.
 * No TELEGRAM_BOT_TOKEN, no HTTP to Telegram.
 */
import type { LLMAdapter, LLMRequest, LLMResponse } from "@agent-runtime/core";
import {
  Agent,
  AgentRuntime,
  InMemoryMemoryAdapter,
  InMemoryRunStore,
} from "@agent-runtime/core";
import {
  ConversationGateway,
  findWaitingRunIdFromRunStore,
  type OutboundDispatcher,
} from "@agent-runtime/conversation-gateway";
import { MockTelegramClient, chatIdFromConversationKey } from "./mockTelegramClient.js";
import {
  telegramMessageToNormalized,
  telegramUpdateToMessage,
} from "./telegramNormalize.js";
import type { TelegramUpdate } from "./telegramTypes.js";

const PROJECT_ID = "telegram-mock-demo";
const AGENT_ID = "telegram-echo-bot";

class ScriptedLlm implements LLMAdapter {
  constructor(private readonly queue: string[]) {}
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const content =
      this.queue[this.i++] ??
      JSON.stringify({ type: "result", content: "(mock LLM queue exhausted)" });
    return { content };
  }
}

function buildOutbound(mock: MockTelegramClient): OutboundDispatcher {
  return {
    async sendReply(conversationKey, text, opts) {
      const chatId = chatIdFromConversationKey(conversationKey);
      await mock.sendMessage(chatId, text, { runId: opts?.runId });
    },
  };
}

async function main(): Promise<void> {
  const runStore = new InMemoryRunStore();
  const memoryAdapter = new InMemoryMemoryAdapter();
  const mockTelegram = new MockTelegramClient();

  const llm = new ScriptedLlm([
    JSON.stringify({ type: "thought", content: "User said hello via Telegram (mock)." }),
    JSON.stringify({
      type: "result",
      content: "Mock bot: got your message. Real setup would call api.telegram.org/sendMessage.",
    }),
  ]);

  const runtime = new AgentRuntime({
    llmAdapter: llm,
    memoryAdapter,
    runStore,
    maxIterations: 10,
  });

  await Agent.define({
    id: AGENT_ID,
    projectId: PROJECT_ID,
    systemPrompt: "You are a concise Telegram assistant (demo).",
    tools: [],
    llm: { provider: "openai", model: "gpt-4o-mini" },
  });

  const seen = new Set<string>();
  const gateway = new ConversationGateway({
    runtime,
    agentId: AGENT_ID,
    resolveSession: (conversationKey) => ({
      sessionId: `sess-${conversationKey}`,
      projectId: PROJECT_ID,
    }),
    findWaitingRunId: (sessionId, agentId) =>
      findWaitingRunIdFromRunStore(runStore, sessionId, agentId),
    outbound: buildOutbound(mockTelegram),
    idempotency: {
      seen: (id) => seen.has(id),
      markProcessed: (id) => void seen.add(id),
    },
    limits: { maxTextLength: 4096 },
  });

  // --- Simulated webhook body (what Telegram POSTs to your server) ---
  const fakeUpdates: TelegramUpdate[] = [
    {
      update_id: 10_001,
      message: {
        message_id: 42,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 77_777_001, type: "private" },
        from: { id: 99_001, first_name: "Demo" },
        text: "Hello from mocked Telegram",
      },
    },
  ];

  for (const update of fakeUpdates) {
    const msg = telegramUpdateToMessage(update);
    if (!msg) continue;
    if (!msg.text?.trim()) {
      console.warn("skip: non-text update");
      continue;
    }
    const normalized = telegramMessageToNormalized(msg);
    await gateway.handleInbound(normalized);
  }

  console.log("--- Mock Telegram outbox (what sendMessage would do) ---");
  for (const row of mockTelegram.outbox) {
    console.log(
      JSON.stringify({ chat_id: row.chatId, text: row.text, run_id: row.runId }, null, 2),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
