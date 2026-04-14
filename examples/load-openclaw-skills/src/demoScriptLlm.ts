import type { LLMAdapter, LLMRequest, LLMResponse } from "@opencoreagents/core";

/**
 * Fixed sequence of Step JSON objects so the run completes without a real LLM.
 */
export class DemoScriptLlm implements LLMAdapter {
  private i = 0;
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    const steps = [
      // Step 1 — protocol “think” turn (no side effects).
      JSON.stringify({
        type: "thought",
        content: "User wants the OpenClaw demo; follow skill openclaw_demo and call exec.",
      }),
      // Step 2 — invoke the exec tool (matches what openclaw_demo SKILL.md describes).
      JSON.stringify({
        type: "action",
        tool: "exec",
        input: { command: "node -p 42" },
      }),
      // Step 3 — final answer after the engine appends the tool observation to history.
      JSON.stringify({
        type: "result",
        content:
          "OpenClaw demo finished: exec ran node -p 42; check observation for stdout 42.",
      }),
    ];
    // Advance one scripted response per engine LLM call; extra calls get a harmless result.
    const content = steps[this.i++] ?? JSON.stringify({ type: "result", content: "done" });
    return { content };
  }
}
