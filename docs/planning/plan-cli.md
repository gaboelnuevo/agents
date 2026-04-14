# CLI planning (`@opencoreagents/cli`)

> Roadmap for the **command-line** surface: what exists today vs the **library-parity** CLI sketched in [`brainstorm/06-library-adapters-cli.md`](../brainstorm/06-library-adapters-cli.md). Complements [`plan.md`](./plan.md) (monorepo/engine) and [`core/14-consumers.md`](../core/14-consumers.md) §CLI.

**Non-goals:** Reimplementing the engine loop in the CLI — all execution stays in **`packages/core`** via **`AgentRuntime`**, **`Agent.load(agentId, runtime, { session })`**, **`RunBuilder`**, hooks.

---

## Current state (repository)

| Area | Status |
|------|--------|
| **`runtime` binary** | **Shipped** — `packages/cli`: `init`, `generate agent|tool|skill` delegating to `@opencoreagents/scaffold`. |
| **Runtime commands** (`run`, `resume`, `memory`, `logs`, `list`, `send`) | **Not in monorepo** — brainstorm only; users run generated project scripts or embed the SDK. |

See [`technical-debt-deferred.md`](./technical-debt-deferred.md#2-cli-and-scaffold) §2 (CLI and scaffold).

---

## Target experience (from brainstorm `06`)

Same semantics as the SDK, for operators and debugging:

```text
runtime list              # agents visible in project / registry
runtime run <agentId> --input "..."
runtime resume <runId> --input "..."
runtime memory <agentId> [--type shortTerm|…]
runtime logs <runId>
runtime send <from> <to> --message "..."   # when multi-agent / bus wired
```

Implementation notes:

- **Session**: construct `Session` (optional `expiresAtMs`, `endUserId`) from flags or env; map **`SessionExpiredError`** to a clear exit code / stderr message.
- **Persistence**: optional local state (e.g. `.agent/` — last `runId`, config) so `resume` and `logs` are usable without passing IDs by hand.
- **Output**: stream or print **hooks** (`onThought`, `onAction`, …) for terminal-friendly inspection (align with [`watchUsage`](../../packages/core/src/engine/watchUsage.ts) if billing-style metrics matter).

---

## Phased plan

| Phase | Goal | Gate |
|-------|------|------|
| **C1 — Design** | Choose scope for v1 (which commands; how **`AgentRuntime`** + env are loaded in a generated project). Document in [`scaffold.md`](./scaffold.md) or a short `docs/core/` CLI subsection. | Written contract; no engine API changes required for C2. |
| **C2 — `run` + `resume`** | Thin wrapper: resolve agent definition + adapters from cwd, **`new AgentRuntime({…})`** → **`Agent.load(agentId, runtime, { session })`** → **`run` / `resume`**, hooks → stdout/stderr, exit codes on **`EngineError.code`**. | Integration test with **`InMemoryRunStore`** or test Redis; CI runs without API keys if LLM is mocked. |
| **C3 — `memory` / `logs`** | Read path: query **`MemoryAdapter`** scopes / print **`Run`** history for a `runId` (format TBD: JSON lines vs human). | Tests + docs for flags. |
| **C4 — `list` / `send`** | `list`: discover agents from project layout or registry. `send`: requires **`MessageBus`** + routing config — likely **after** C2 stable. | E2E optional; document cluster vs in-process bus. |

---

## Dependencies

- **Engine**: stable **`Agent`**, **`RunBuilder`**, **`AgentRuntime`**, **`Session`** (incl. expiry).
- **Scaffold**: templates that expose a **single way** to load env + adapters so the CLI does not fork configuration logic.
- **Multi-agent**: [`system_send_message`](../../packages/core/src/tools/sendMessage.ts) + bus — CLI `send` is orchestration glue, not core.

---

## References

- Runnable baseline without runtime subcommands: [`examples/minimal-run`](../../examples/minimal-run/) (`Agent.run` + mock LLM); OpenClaw / AgentSkills **`SKILL.md`** + **`exec`**: [`examples/load-openclaw-skills`](../../examples/load-openclaw-skills/).
- Brainstorm: [`06-library-adapters-cli.md`](../brainstorm/06-library-adapters-cli.md) (folder layout, MVP bullets).
- Multi-agent + CLI snippet: [`07-multi-agent-rest-sessions.md`](../brainstorm/07-multi-agent-rest-sessions.md) §Extra CLI.
- Consumers overview: [`core/14-consumers.md`](../core/14-consumers.md).
