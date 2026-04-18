import { describe, expect, it } from "vitest";
import { RUNTIME_FETCH_RUN_TOOL_ID } from "../src/runtime/fetchRunTool.js";
import { RUNTIME_INVOKE_PLANNER_TOOL_ID } from "../src/runtime/invokePlannerTool.js";
import { DEFAULT_CHAT_AGENT_TOOL_IDS, chatAgentToolIds } from "../src/runtime/runtimeChat.js";
import { defaultStackConfig } from "../src/config/defaults.js";

describe("default chat agent tools", () => {
  it("includes invoke_planner, runtime_fetch_run, memory, and system_send_message", () => {
    expect(DEFAULT_CHAT_AGENT_TOOL_IDS).toContain(RUNTIME_INVOKE_PLANNER_TOOL_ID);
    expect(DEFAULT_CHAT_AGENT_TOOL_IDS).toContain(RUNTIME_FETCH_RUN_TOOL_ID);
    expect(DEFAULT_CHAT_AGENT_TOOL_IDS).toContain("system_save_memory");
    expect(DEFAULT_CHAT_AGENT_TOOL_IDS).toContain("system_get_memory");
    expect(DEFAULT_CHAT_AGENT_TOOL_IDS).toContain("system_send_message");
  });

  it("adds artifact tool only when artifacts are enabled", () => {
    expect(chatAgentToolIds(defaultStackConfig)).not.toContain("system_write_artifact");
    expect(
      chatAgentToolIds({
        ...defaultStackConfig,
        artifacts: { ...defaultStackConfig.artifacts, enabled: true },
      }),
    ).toContain("system_write_artifact");
  });
});
