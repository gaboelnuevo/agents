# `@opencoreagents/core`

Stateful agent **engine**: `Agent`, `AgentRuntime`, `Tool` / `Skill` / `Agent.define`, `RunBuilder`, `executeRun`, protocol loop (`thought` → `action` → `observation` → `result`, `wait` / `resume`), built-in tools, and **`dispatchEngineJob`** / **`AgentRuntime.dispatch`** for queue workers.

Sessions support optional expiry via `expiresAtMs`, plus renewal helpers like `session.withExpiresAt(...)` and `session.extendBy(ttlMs)`.

## Related docs

Canonical engine index: [`docs/core/README.md`](../../docs/core/README.md).
