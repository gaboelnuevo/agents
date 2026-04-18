import { StepSchemaError } from "../errors/index.js";
import type { Step } from "../protocol/types.js";

/** Strip UTF-8 BOM and trim. */
function normalizeRawInput(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

/**
 * If the whole message (or leading segment) is one ``` fence, return inner text.
 * Also finds the first fenced block embedded after prose.
 */
export function stripFences(raw: string): string {
  const trimmed = normalizeRawInput(raw);
  const fullFence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/m.exec(trimmed);
  if (fullFence) return fullFence[1]!.trim();
  const embedded = /```(?:json)?\s*\n?([\s\S]*?)```/m.exec(trimmed);
  if (embedded) return embedded[1]!.trim();
  return trimmed;
}

/** Every ``` / ```json … ``` inner slice (for models that emit multiple blocks). */
function allFenceInners(raw: string): string[] {
  const out: string[] = [];
  const re = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const inner = m[1]?.trim();
    if (inner) out.push(inner);
  }
  return out;
}

/**
 * First `{ … }` slice with brace depth outside of JSON strings (handles `"}"` inside values).
 */
export function extractFirstBalancedJsonObject(s: string): string | undefined {
  const start = s.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = false;
        continue;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return undefined;
}

function pushUnique(list: string[], s: string): void {
  const t = s.trim();
  if (!t || list.includes(t)) return;
  list.push(t);
}

/** Ordered candidates: fences, then balanced JSON from each useful substring. */
function buildParseCandidates(raw: string): string[] {
  const trimmed = normalizeRawInput(raw);
  const candidates: string[] = [];
  pushUnique(candidates, stripFences(trimmed));
  for (const inner of allFenceInners(trimmed)) {
    pushUnique(candidates, inner);
    const bal = extractFirstBalancedJsonObject(inner);
    if (bal) pushUnique(candidates, bal);
  }
  const strippedOnce = stripFences(trimmed);
  const balMain = extractFirstBalancedJsonObject(strippedOnce);
  if (balMain) pushUnique(candidates, balMain);
  const balFull = extractFirstBalancedJsonObject(trimmed);
  if (balFull) pushUnique(candidates, balFull);
  return candidates;
}

function unwrapSingleElementArray(parsed: unknown): Record<string, unknown> | undefined {
  if (parsed == null || typeof parsed !== "object") return undefined;
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) return undefined;
    const only = parsed[0];
    if (only != null && typeof only === "object" && !Array.isArray(only)) {
      return only as Record<string, unknown>;
    }
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

function validateStepShape(obj: Record<string, unknown>): Step {
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

/**
 * Parse one protocol {@link Step} from model output. Tolerant of:
 * - Markdown fences (full message or embedded), with or without `json` tag
 * - Leading / trailing prose; first balanced `{ … }` JSON object
 * - A single-element JSON array wrapping the step object
 */
export function parseStep(raw: string): Step {
  const candidates = buildParseCandidates(raw);
  let lastSchema: StepSchemaError | undefined;
  for (const json of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const obj = unwrapSingleElementArray(parsed);
    if (!obj) continue;
    try {
      return validateStepShape(obj);
    } catch (e) {
      if (e instanceof StepSchemaError) lastSchema = e;
    }
  }
  if (lastSchema) throw lastSchema;
  throw new StepSchemaError("Invalid JSON for Step");
}
