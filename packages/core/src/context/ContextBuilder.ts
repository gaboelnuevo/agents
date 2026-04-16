import type { LLMRequest } from "../adapters/llm/LLMAdapter.js";
import type { ContextBuilderInput, BuiltContext } from "./types.js";
import { getSkillDefinition, getToolDefinition } from "../define/registry.js";

function toolCatalogForAgent(
  projectId: string,
  agent: import("../define/types.js").AgentDefinition,
  registry: Map<string, import("../adapters/tool/ToolAdapter.js").ToolAdapter>,
): LLMRequest["tools"] {
  const allow = new Set(agent.tools ?? []);
  for (const sid of agent.skills ?? []) {
    const sk = getSkillDefinition(projectId, sid);
    if (sk) for (const tid of sk.tools) allow.add(tid);
  }
  const out: NonNullable<LLMRequest["tools"]> = [];
  for (const name of allow) {
    const t = registry.get(name);
    if (!t) continue;
    const def = getToolDefinition(projectId, name);
    out.push({
      name: t.name,
      description: def?.description,
      parameters:
        (def?.inputSchema as object | undefined) ??
        ({ type: "object", properties: {} } as object),
    });
  }
  return out.length ? out : undefined;
}

/**
 * MVP Context Builder: system prompt + optional tool schemas + protocol history as chat + user input.
 * Memory sections from docs §5 can be layered in later; hooks query MemoryAdapter when implemented.
 */
export class ContextBuilder {
  async build(input: ContextBuilderInput): Promise<BuiltContext> {
    const { agent, run, session, toolRegistry, resumeMessages, recoveryMessages } = input;
    const projectId = session.projectId;

    const system =
      `${agent.systemPrompt}\n\n` +
      `Respond with exactly one JSON object per turn (no prose outside JSON) with a "type" field: ` +
      `thought | action | wait | result.`;

    const messages: LLMRequest["messages"] = [{ role: "system", content: system }];

    const userText = (run.state.userInput as string | undefined) ?? "";
    if (userText) {
      messages.push({ role: "user", content: userText });
    }

    const continueList = (run.state.continueInputs ?? []).filter(
      (t): t is string => typeof t === "string" && Boolean(t.trim()),
    );
    const resumeList = (run.state.resumeInputs ?? []).filter(
      (t): t is string => typeof t === "string" && Boolean(t.trim()),
    );
    let continueIdx = 0;
    let resumeIdx = 0;

    for (const m of run.history) {
      if (m.type === "thought" || m.type === "result") {
        messages.push({
          role: "assistant",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
        /**
         * Interleave **`continueInputs`** after each completed **`result`** so the transcript reads
         * user₁ → assistant₁ → user₂ → assistant₂ … instead of all assistant turns followed by a
         * stack of user lines (which confused models into mega-recaps on later turns).
         */
        if (m.type === "result" && continueIdx < continueList.length) {
          messages.push({ role: "user", content: continueList[continueIdx++]! });
        }
      } else if (m.type === "action") {
        const c = m.content as { tool?: string; input?: unknown };
        messages.push({
          role: "assistant",
          content: JSON.stringify({
            type: "action",
            tool: c.tool,
            input: c.input,
          }),
        });
      } else if (m.type === "observation") {
        messages.push({
          role: "user",
          content: `Observation: ${JSON.stringify(m.content)}`,
        });
      } else if (m.type === "wait") {
        const wc = m.content as { reason?: string; details?: unknown };
        messages.push({
          role: "assistant",
          content: JSON.stringify({
            type: "wait",
            reason: wc.reason,
            details: wc.details,
          }),
        });
        /**
         * Resume text is stored on **`run.state.resumeInputs`**, not as normal history rows — splice
         * the next line after each **`wait`** so it mirrors the real conversation order.
         */
        if (resumeIdx < resumeList.length) {
          messages.push({ role: "user", content: resumeList[resumeIdx++]! });
        }
      }
    }

    /**
     * `executeRun` only passes `resumeMessages` on the **first** `contextBuilder.build` call. If the
     * model returns `thought` or `action` before `result`, later iterations would drop the new user
     * turn. Any **`continueInputs` / `resumeInputs`** not yet spliced (e.g. store skew) are appended so
     * multi-step turns still see the latest user text.
     */
    while (continueIdx < continueList.length) {
      messages.push({ role: "user", content: continueList[continueIdx++]! });
    }
    while (resumeIdx < resumeList.length) {
      messages.push({ role: "user", content: resumeList[resumeIdx++]! });
    }

    if (resumeMessages?.length) {
      for (const r of resumeMessages) {
        const c = typeof r.content === "string" ? r.content : "";
        if (/^\[continue:user\]\s/.test(c) || /^\[resume:/.test(c)) continue;
        messages.push(r);
      }
    }

    if (recoveryMessages?.length) {
      for (const r of recoveryMessages) messages.push(r);
    }

    const tools = toolCatalogForAgent(projectId, agent, toolRegistry);

    return {
      messages,
      tools,
      toolChoice: tools?.length ? "auto" : "none",
      responseFormat: { type: "json_object" },
    };
  }
}
