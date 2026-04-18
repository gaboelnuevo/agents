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

function coerceArgumentsField(argumentsField: unknown): unknown {
  if (typeof argumentsField === "string") {
    try {
      return JSON.parse(argumentsField) as unknown;
    } catch {
      return { _rawArguments: argumentsField };
    }
  }
  if (argumentsField != null && typeof argumentsField === "object" && !Array.isArray(argumentsField)) {
    return argumentsField;
  }
  return {};
}

/** Prefer **`params`**, **`parameters`**, **`input`**, then string/object **`arguments`** (OpenAI tool style). */
function pickActionInputFromRecord(r: Record<string, unknown>): unknown {
  if ("params" in r && r.params != null && typeof r.params === "object" && !Array.isArray(r.params)) {
    return r.params;
  }
  if (
    "parameters" in r &&
    r.parameters != null &&
    typeof r.parameters === "object" &&
    !Array.isArray(r.parameters)
  ) {
    return r.parameters;
  }
  if ("input" in r) return r.input ?? {};
  if ("arguments" in r) return coerceArgumentsField(r.arguments);
  return {};
}

/**
 * Some models emit tool-style JSON in **content** (no native **`toolCalls`**), e.g.
 * `{ "type": "action", "action": { "name": "invoke_planner", "params": { … } } }` or
 * `{ "type": "action", "name": "…", "params": { … } }`. Map to **`{ type: "action", tool, input }`**.
 */
function normalizeAlternateActionShape(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj.type !== "action") return obj;

  if (typeof obj.tool === "string") {
    if (!("input" in obj)) return { ...obj, input: {} };
    return obj;
  }

  const nested = obj.action;
  if (nested != null && typeof nested === "object" && !Array.isArray(nested)) {
    const a = nested as Record<string, unknown>;
    const toolName =
      (typeof a.name === "string" && a.name) || (typeof a.tool === "string" && a.tool) || "";
    if (toolName) {
      const input = pickActionInputFromRecord(a);
      const { action: _nested, ...rest } = obj;
      return { ...rest, type: "action", tool: toolName, input };
    }
  }

  const fc = obj.function_call;
  if (fc != null && typeof fc === "object" && !Array.isArray(fc)) {
    const f = fc as Record<string, unknown>;
    if (typeof f.name === "string" && f.name) {
      const input = pickActionInputFromRecord(f);
      const { function_call: _fc, ...rest } = obj;
      return { ...rest, type: "action", tool: f.name, input };
    }
  }

  if (typeof obj.name === "string" && obj.name) {
    const input = pickActionInputFromRecord(obj);
    const rest = { ...obj };
    delete rest.name;
    delete rest.params;
    delete rest.parameters;
    delete rest.input;
    delete rest.action;
    delete rest.function_call;
    delete rest.tool;
    return { ...rest, type: "action", tool: obj.name, input };
  }

  return obj;
}

/**
 * Chat-style models emit **`message`** or **`text`** instead of **`content`** for **`thought`/`result`**.
 * Only fills **`content`** when it is missing or nullish; non-string **`content`** (object/array) is left for
 * {@link coerceThoughtResultContentToString}.
 */
function normalizeThoughtResultMessageToContent(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj.type !== "thought" && obj.type !== "result") return obj;
  const c = obj.content;
  if (typeof c === "string") return obj;
  if (c != null && typeof c === "object") return obj;

  const alt =
    typeof obj.message === "string"
      ? obj.message
      : typeof obj.text === "string"
        ? obj.text
        : undefined;
  if (alt === undefined) return obj;
  const rest = { ...obj };
  delete rest.message;
  delete rest.text;
  return { ...rest, content: alt };
}

/**
 * Models often emit **`result`** / **`thought`** with **`content`** as an object or array; the engine protocol
 * requires **`content`: string**. Coerce with **`JSON.stringify`** (empty string for nullish).
 */
function coerceThoughtResultContentToString(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj.type !== "thought" && obj.type !== "result") return obj;
  if (!("content" in obj)) return obj;
  const c = obj.content;
  if (typeof c === "string") return obj;
  if (c === null || c === undefined) return { ...obj, content: "" };
  try {
    return { ...obj, content: JSON.stringify(c) };
  } catch {
    return { ...obj, content: String(c) };
  }
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
 * - Alternate **action** shapes: nested **`{ action: { name, params } }`**, top-level **`name`/`params`**, or **`function_call`**
 * - **`thought`** / **`result`** with **`message`** or **`text`** instead of **`content`** (when **`content`** is absent/nullish)
 * - **`thought`** / **`result`** with **`content`** as JSON object or array → stringified
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
      return validateStepShape(
        coerceThoughtResultContentToString(
          normalizeThoughtResultMessageToContent(normalizeAlternateActionShape(obj)),
        ),
      );
    } catch (e) {
      if (e instanceof StepSchemaError) lastSchema = e;
    }
  }
  if (lastSchema) throw lastSchema;
  throw new StepSchemaError("Invalid JSON for Step");
}
