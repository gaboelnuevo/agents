import { StepSchemaError } from "../errors/index.js";
import type { Step } from "../protocol/types.js";

export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(trimmed);
  if (fence) return fence[1]!.trim();
  return trimmed;
}

export function parseStep(raw: string): Step {
  const json = stripFences(raw);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new StepSchemaError("Invalid JSON for Step");
  }
  const t = obj.type;
  if (typeof t !== "string" || !["thought", "action", "wait", "result"].includes(t)) {
    throw new StepSchemaError(`Invalid step type: ${String(t)}`);
  }
  switch (t) {
    case "thought":
    case "result":
      if (typeof obj.content !== "string") throw new StepSchemaError("Missing content");
      break;
    case "action":
      if (typeof obj.tool !== "string") throw new StepSchemaError("Missing tool");
      break;
    case "wait":
      if (typeof obj.reason !== "string") throw new StepSchemaError("Missing reason");
      break;
    default:
      throw new StepSchemaError(`Invalid step type: ${t}`);
  }
  return obj as Step;
}
