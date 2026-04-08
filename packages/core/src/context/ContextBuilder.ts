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

    for (const m of run.history) {
      if (m.type === "thought" || m.type === "result") {
        messages.push({
          role: "assistant",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
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
      }
    }

    if (resumeMessages?.length) {
      for (const r of resumeMessages) messages.push(r);
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
