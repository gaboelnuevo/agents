import {
  loadOpenClawSkills,
  registerOpenClawExecTool,
} from "@opencoreagents/skill-loader-openclaw";

export interface OpenClawBootstrapResult {
  /**
   * Skill ids from disk (`SKILL.md` `name`). Prefer **`openClawAgentRuntimeSlice(result)`** from
   * **`runtimeShared`** when spreading into **`new AgentRuntime({ … })`** (worker today; API if you add
   * in-process dispatch) so **`defaultSkillIdsGlobal`** stays identical across processes.
   */
  defaultSkillIdsGlobal: readonly string[];
}

/**
 * Loads OpenClaw / AgentSkills-style `SKILL.md` packs from disk and registers them for `projectId`.
 * Call from **both** API and worker so the in-process skill registry stays aligned (then Redis sync on the API replays store-backed skills).
 * When any skill loads, registers the global `exec` tool expected by many OpenClaw skills.
 *
 * Agents still need `"exec"` in their **tools** list (Redis `/v1`) when a skill runs external commands;
 * skill metadata does not add tools to the allowlist automatically.
 */
export async function bootstrapOpenClawSkills(options: {
  enabled: boolean;
  skillsDirs: string[];
  projectId: string;
}): Promise<OpenClawBootstrapResult> {
  const { enabled, skillsDirs, projectId } = options;

  if (!enabled) {
    return { defaultSkillIdsGlobal: [] };
  }

  if (skillsDirs.length === 0) {
    console.log(
      "[opencoreagents-runtime] openclaw.enabled is true but openclaw.skillsDirs is empty — no OpenClaw skills loaded",
    );
    return { defaultSkillIdsGlobal: [] };
  }

  const { loaded, skipped } = await loadOpenClawSkills({
    dirs: skillsDirs,
    scope: "project",
    projectId,
    onLoaded: (name) => console.log(`[opencoreagents-runtime] openclaw skill loaded: ${name}`),
    onSkipped: (name, reason) =>
      console.log(`[opencoreagents-runtime] openclaw skill skipped: ${name} — ${reason}`),
    onSkillParseError: (p, err) =>
      console.warn(`[opencoreagents-runtime] openclaw SKILL.md parse error: ${p}`, err),
  });

  console.log(
    `[opencoreagents-runtime] openclaw: ${loaded.length} loaded, ${skipped.length} skipped (projectId=${projectId})`,
  );

  if (loaded.length === 0) {
    return { defaultSkillIdsGlobal: [] };
  }

  await registerOpenClawExecTool();
  console.log(
    "[opencoreagents-runtime] openclaw: registered global `exec` tool — add \"exec\" to agent tools in /v1 when skills run commands",
  );

  return { defaultSkillIdsGlobal: loaded };
}
