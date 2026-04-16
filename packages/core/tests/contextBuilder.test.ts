import { describe, expect, it } from "vitest";
import type { Run } from "../src/protocol/types.js";
import type { AgentDefinition } from "../src/define/types.js";
import type { SecurityContext } from "../src/security/types.js";
import { ContextBuilder } from "../src/context/ContextBuilder.js";
import { Session } from "../src/define/Session.js";
import { InMemoryMemoryAdapter } from "../src/index.js";

const stubAgent: AgentDefinition = {
  id: "a",
  projectId: "p",
  systemPrompt: "You are helpful.",
  tools: [],
  llm: { provider: "openai", model: "gpt-4o-mini" },
};

const stubSecurity: SecurityContext = {
  principalId: "internal",
  kind: "internal",
  organizationId: "p",
  projectId: "p",
  roles: ["agent"],
  scopes: ["*"],
};

describe("ContextBuilder", () => {
  it("splices continueInputs after each result (chronological user turns)", async () => {
    const run: Run = {
      runId: "r1",
      agentId: "a",
      sessionId: "s",
      status: "running",
      history: [
        {
          type: "result",
          content: "Answer about A",
          meta: { ts: "1", source: "llm" },
        },
        {
          type: "thought",
          content: "think B",
          meta: { ts: "2", source: "llm" },
        },
        {
          type: "result",
          content: "Answer about B",
          meta: { ts: "3", source: "llm" },
        },
      ],
      state: {
        iteration: 0,
        pending: null,
        userInput: "first question",
        continueInputs: ["second question", "third question"], // two `result` rows → two splices
      },
    };

    const cb = new ContextBuilder();
    const built = await cb.build({
      agent: stubAgent,
      run,
      session: new Session({ id: "s", projectId: "p" }),
      memoryAdapter: new InMemoryMemoryAdapter(),
      securityContext: stubSecurity,
      toolRegistry: new Map(),
    });

    const roles = built.messages.map((m) => m.role);
    expect(roles[0]).toBe("system");
    expect(roles[1]).toBe("user");
    expect(built.messages[1]!.content).toBe("first question");
    expect(roles[2]).toBe("assistant");
    expect(built.messages[2]!.content).toContain("Answer about A");
    expect(roles[3]).toBe("user");
    expect(built.messages[3]!.content).toBe("second question");
    expect(roles[4]).toBe("assistant");
    expect(built.messages[4]!.content).toContain("think B");
    expect(roles[5]).toBe("assistant");
    expect(built.messages[5]!.content).toContain("Answer about B");
    expect(roles[6]).toBe("user");
    expect(built.messages[6]!.content).toBe("third question");
  });

  it("splices resumeInputs after each wait", async () => {
    const run: Run = {
      runId: "r2",
      agentId: "a",
      status: "running",
      history: [
        {
          type: "wait",
          content: { reason: "need", details: {} },
          meta: { ts: "1", source: "llm" },
        },
        {
          type: "result",
          content: "after resume",
          meta: { ts: "2", source: "llm" },
        },
      ],
      state: {
        iteration: 0,
        pending: null,
        userInput: "start",
        resumeInputs: ["user resume text"],
      },
    };

    const cb = new ContextBuilder();
    const built = await cb.build({
      agent: stubAgent,
      run,
      session: new Session({ id: "s", projectId: "p" }),
      memoryAdapter: new InMemoryMemoryAdapter(),
      securityContext: stubSecurity,
      toolRegistry: new Map(),
    });

    const users = built.messages.filter((m) => m.role === "user").map((m) => m.content as string);
    expect(users[0]).toBe("start");
    expect(users[1]).toBe("user resume text");
    expect(users).toHaveLength(2);
  });
});
