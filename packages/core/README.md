# `@opencoreagents/core`

Stateful agent **engine**: `Agent`, `AgentRuntime`, `Tool` / `Skill` / `Agent.define`, `RunBuilder`, `executeRun`, protocol loop (`thought` → `action` → `observation` → `result`, `wait` / `resume`), built-in tools, and **`dispatchEngineJob`** / **`AgentRuntime.dispatch`** for queue workers.

Sessions carry the required `projectId`, optional `tenantId` sub-scope for run isolation, optional expiry via `expiresAtMs`, and renewal helpers like `session.withExpiresAt(...)` and `session.extendBy(ttlMs)`.

## Related docs

Canonical engine index: [`docs/reference/core/README.md`](../../docs/reference/core/README.md).

## Base Prompts (Protocol-Safe)

Use exported base prompts to avoid step-schema drift in app-level custom prompts:

- `BASE_PROMPT`
- `BASE_PROMPT_WITH_SHORT_ANSWERS`

Both enforce protocol-compatible `result` steps:

```json
{ "type": "result", "content": "..." }
```

`BASE_PROMPT_WITH_SHORT_ANSWERS` keeps the same outer protocol and requires `content` to encode JSON text with:

```json
{
  "reply": "string",
  "short_answers": []
}
```

Copy/paste usage:

```ts
import { BASE_PROMPT_WITH_SHORT_ANSWERS } from "@opencoreagents/core";

const systemPrompt = [
  BASE_PROMPT_WITH_SHORT_ANSWERS,
  "You are a support copilot for billing and onboarding.",
].join("\n\n");
```
