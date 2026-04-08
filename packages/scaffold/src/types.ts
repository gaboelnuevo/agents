export type ScaffoldTemplate = "default" | "minimal" | "multi-agent";

export type ScaffoldAdapterPreset = "upstash" | "redis" | "memory";

export type ScaffoldLlmPreset = "openai" | "anthropic" | "custom";

export type ScaffoldPackageManager = "npm" | "pnpm" | "yarn";

export type InitProjectOptions = {
  /** Directory name / npm package name segment */
  name: string;
  /** Absolute path to the directory that will contain the project root */
  path: string;
  template?: ScaffoldTemplate;
  adapter?: ScaffoldAdapterPreset;
  llm?: ScaffoldLlmPreset;
  packageManager?: ScaffoldPackageManager | "auto";
  /** When true, overwrite existing files. When false, existing files are left unchanged and listed under `skipped`. */
  force?: boolean;
};

export type GenerateAgentOptions = {
  projectPath: string;
  agentId: string;
  skills?: string[];
  tools?: string[];
  /** When false, skip generating the companion test file. Default true. */
  withTest?: boolean;
  /** Overrides default `gpt-4o` in the generated agent `llm.model` field. */
  llmModel?: string;
  force?: boolean;
};

export type GenerateToolOptions = {
  projectPath: string;
  /** Tool id as used in the registry (e.g. `send_email` or `send-email` — normalized to snake_case id). */
  toolId: string;
  force?: boolean;
};

export type GenerateSkillOptions = {
  projectPath: string;
  /** Skill id (e.g. `intake-summary` → `intakeSummary`). */
  skillId: string;
  tools?: string[];
  force?: boolean;
};

export type ScaffoldManifest = {
  /** Project-relative POSIX paths of files that were written */
  created: string[];
  /** Project-relative paths that already existed and were not overwritten */
  skipped: string[];
};
