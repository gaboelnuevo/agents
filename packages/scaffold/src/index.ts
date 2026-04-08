import { initProject } from "./init-project.js";
import {
  generateAgent,
  generateSkill,
  generateTool,
} from "./generate.js";

export type {
  InitProjectOptions,
  GenerateAgentOptions,
  GenerateToolOptions,
  GenerateSkillOptions,
  ScaffoldManifest,
  ScaffoldTemplate,
  ScaffoldAdapterPreset,
  ScaffoldLlmPreset,
  ScaffoldPackageManager,
} from "./types.js";

/** Programmatic project and file generation (see `docs/core/18-scaffold.md`). */
export const scaffold = {
  initProject,
  generateAgent,
  generateTool,
  generateSkill,
} as const;
