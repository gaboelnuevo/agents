import type { ToolAdapter, ToolDefinition, SkillDefinition } from "@agent-runtime/core";
import { fileReadTool, fileReadDefinition } from "./tools/fileRead.js";
import { fileIngestTool, fileIngestDefinition } from "./tools/fileIngest.js";
import { fileListTool, fileListDefinition } from "./tools/fileList.js";
import { ragSkill, ragReaderSkill } from "./skills/rag.js";

export interface RagRegistration {
  tools: Array<{ definition: ToolDefinition; handler: ToolAdapter }>;
  skills: SkillDefinition[];
}

/**
 * Returns all RAG tool definitions, handlers, and skill definitions
 * for registration via the core registry.
 */
export function getRagRegistrations(): RagRegistration {
  return {
    tools: [
      { definition: fileReadDefinition as ToolDefinition, handler: fileReadTool },
      { definition: fileIngestDefinition as ToolDefinition, handler: fileIngestTool },
      { definition: fileListDefinition as ToolDefinition, handler: fileListTool },
    ],
    skills: [ragSkill, ragReaderSkill],
  };
}
