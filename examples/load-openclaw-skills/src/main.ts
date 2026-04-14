/**
 * Loads OpenClaw-style SKILL.md skills from ../skills, registers `exec`,
 * attaches them to the runtime via `defaultSkillIdsGlobal` (all agents inherit
 * those skills), merges skill instructions into the system
 * prompt (ContextBuilder does not append skill bodies yet), and runs a short
 * scripted loop that calls `exec`.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Agent,
  AgentRuntime,
  Session,
  InMemoryMemoryAdapter,
  getSkillDefinition,
} from "@opencoreagents/core";
import { loadOpenClawSkills, registerOpenClawExecTool } from "@opencoreagents/skill-loader-openclaw";
import { DemoScriptLlm } from "./demoScriptLlm.js";

/** Tenant / project id for definitions, session, and skill resolution. */
const PROJECT_ID = "demo-openclaw";

/** Parent folder: each subfolder with a SKILL.md is one OpenClaw skill. */
const skillsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

/** Builds extra system text from registered skills (ContextBuilder does not inject skill bodies today). */
function openClawSkillPromptBlock(skillIds: string[]): string {
  const parts: string[] = [];
  for (const id of skillIds) {
    const sk = getSkillDefinition(PROJECT_ID, id);
    if (sk?.description) {
      parts.push(`### Skill \`${id}\`\n${sk.description}`);
    }
  }
  if (!parts.length) return "";
  return `\n\n## Loaded OpenClaw skills\n${parts.join("\n\n")}`;
}

async function main(): Promise<void> {
  // 1. Parse SKILL.md files, run gates, register each eligible skill via Skill.define.
  const { loaded: openclawSkillsIds, skipped } = await loadOpenClawSkills({
    dirs: [skillsRoot],
    onLoaded: (name) => console.log(`[openclaw] loaded skill: ${name}`),
    onSkipped: (name, reason) => console.log(`[openclaw] skipped skill: ${name} — ${reason}`),
    onSkillParseError: (p, err) =>
      console.warn(`[openclaw] SKILL.md parse failed: ${p}`, err),
  });

  // 2. Log load outcome (e.g. gated_missing_bin skipped, openclaw_demo loaded).
  console.log(`[openclaw] summary: ${openclawSkillsIds.length} loaded, ${skipped.length} skipped`);

  // 3. Register the shell-less exec tool OpenClaw skills expect.
  await registerOpenClawExecTool();

  // 4. Base system instructions plus inlined skill text for the model.
  const basePrompt =
    "You are a demo agent. Follow the JSON Step protocol. " +
    "When skills apply, obey their instructions.";

  // 5. Agent: allow exec. Skill ids are preloaded on the runtime (step 6) via `defaultSkillIdsGlobal`
  //    so you need not repeat `skills: loaded` on each Agent.define.
  await Agent.define({
    id: "openclaw-demo-agent",
    projectId: PROJECT_ID,
    systemPrompt: basePrompt + openClawSkillPromptBlock(openclawSkillsIds),
    tools: ["exec"],
    llm: { provider: "openai", model: "gpt-4o-mini" },
  });

  // 6. Runtime: mock LLM + in-process memory + default OpenClaw skills for every agent.
  const defaultSkillIdsGlobal = openclawSkillsIds;
  const runtime = new AgentRuntime({
    llmAdapter: new DemoScriptLlm(), // or OpenAILLMAdapter etc.
    memoryAdapter: new InMemoryMemoryAdapter(),
    maxIterations: 10,
    defaultSkillIdsGlobal: defaultSkillIdsGlobal,
  });

  // 7. Session ties the run to projectId (and optional fileReadRoot / sessionContext in real apps).
  const session = new Session({
    id: "openclaw-session-1",
    projectId: PROJECT_ID,
  });

  // 8. Bind agent definition + runtime + session, then execute one user turn.
  const agent = await Agent.load("openclaw-demo-agent", runtime, { session });
  const run = await agent.run("Run the OpenClaw demo skill.");

  // 9. Inspect final run: status, tool observation, closing result step.
  console.log("run status:", run.status);
  for (const h of run.history) {
    if (h.type === "observation") {
      console.log("observation:", JSON.stringify(h.content, null, 2));
    }
  }
  const result = run.history.find((h) => h.type === "result");
  if (result && typeof result.content === "string") {
    console.log("result:", result.content);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
