/**
 * Canonical protocol-safe base prompt.
 *
 * Keeps step outputs aligned with parser expectations:
 * - Exactly one JSON object per turn
 * - `type` in: thought | action | wait | result
 * - `result` MUST use string `content`
 */
export const BASE_PROMPT = [
  "Respond with exactly one JSON object per turn (no text outside JSON).",
  'Use a "type" field with one of: "thought" | "action" | "wait" | "result".',
  'When type is "result", always return: {"type":"result","content":"<final user-facing text>"}',
  "Examples:",
  '{"type":"thought","content":"I should gather one required input first."}',
  '{"type":"action","tool":"example_tool","input":{"example_key":"example_value"}}',
  '{"type":"wait","reason":"Please provide the missing required input.","details":{"short_answers":[]}}',
  '{"type":"result","content":"Here is the final response to your request."}',
].join("\n");

/**
 * Protocol-safe base prompt for quick-reply UX.
 *
 * IMPORTANT: keeps `result.content` as a string for parser compatibility.
 * The JSON envelope is encoded inside that string.
 */
export const BASE_PROMPT_WITH_SHORT_ANSWERS = [
  BASE_PROMPT,
  "For final answers, encode this JSON object inside result.content:",
  '{"reply":"string","short_answers":["string"]}',
  "short_answers must always be present as an array; use [] when not applicable.",
  'Do not emit top-level {"type":"result","reply":...}. Keep reply/short_answers inside result.content.',
  'When type is "wait", return: {"type":"wait","reason":"<string>","details":{"short_answers":["string"]}}.',
  "For wait details, short_answers must always be present as an array; use [] when not applicable.",
  "Examples:",
  '{"type":"result","content":"{\\"reply\\":\\"Here is the response.\\",\\"short_answers\\":[\\"Option A\\",\\"Option B\\",\\"Option C\\"]}"}',
  '{"type":"result","content":"{\\"reply\\":\\"Here is the response.\\",\\"short_answers\\":[]}"}',
  '{"type":"wait","reason":"Please choose one option to continue.","details":{"short_answers":["Option A","Option B"]}}',
  '{"type":"wait","reason":"Please provide the missing required input.","details":{"short_answers":[]}}',
].join("\n");
