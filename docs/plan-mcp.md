# MCP planning (Model Context Protocol)

> Roadmap for exposing the runtime to **MCP hosts** (Cursor, Claude Desktop, etc.) as a **channel**, not a second engine. The core loop stays in **`packages/core`**; MCP maps **tools/resources** to your policies and optionally to HTTP or in-process calls. Source context: [`core/14-consumers.md`](./core/14-consumers.md) §MCP, [`01-purpose.md`](./core/01-purpose.md) (layers).

**Principle:** MCP **does not replace** the engine — it is a **plug** through which the host’s model may invoke **your** tools or trigger **your** `run`/`resume` pipeline.

---

## Current state (repository)

| Area | Status |
|------|--------|
| **`@agent-runtime/mcp` or bundled MCP server** | **Not shipped** — no first-party MCP package in the workspace (see [`technical-debt.md`](./technical-debt.md) §5). |
| **Interop story** | **Documented at pattern level** in `14-consumers.md`. |

---

## Design options

| Approach | Pros | Cons |
|----------|------|------|
| **A — MCP → REST** | One backend contract ([`plan-rest.md`](./plan-rest.md)); MCP server is a thin HTTP client; easy multi-tenant and auth at the API layer. | Extra hop; requires REST to exist. |
| **B — MCP → SDK in-process** | Low latency; good for single-user local dev. | Must embed **`AgentRuntime`** + secrets in the MCP host process; harder to share across teams. |
| **C — MCP tools = subset of ToolRunner** | Aligns names/inputs with existing **tools** and **skills**. | Mapping and versioning discipline; security: MCP must not bypass **`SecurityLayer`**. |

Recommended default for a **platform**: **A** or **A + C** (MCP tool list is a curated projection of allowed tools, each delegating to REST).

---

## Phased plan

| Phase | Goal | Gate |
|-------|------|------|
| **M1 — Scope** | List which user actions MCP exposes: e.g. “start run”, “resume with text”, “query memory”, **not** raw arbitrary tool execution unless allowlisted. | Written threat model (prompt injection, tool exfiltration). |
| **M2 — Protocol skeleton** | Minimal MCP server package (or example repo) implementing handshake + one **tool** calling **`POST /agents/:id/run`** or local **`new AgentRuntime({…})`** → **`Agent.load(agentId, runtime, { session }).run(...)`**. | Manual test with one host (e.g. Cursor). |
| **M3 — Parity** | Tool definitions stay in sync with **`Tool.define`** / project registry — generation or shared manifest to avoid drift. | CI check or codegen from definitions. |
| **M4 — Multi-agent** | If hosts need “message agent B”, expose a single MCP tool that maps to **`send_message`** + bus semantics ([`09-communication-multiagent.md`](./core/09-communication-multiagent.md)). | Document correlation / `wait` expectations. |

---

## Session and errors

- Pass **session** identity via MCP **metadata** or env → construct **`Session`** (including **`expiresAtMs`** if the host session mirrors a web session).
- Surface **`SessionExpiredError`** / **`EngineError.code`** as MCP-friendly error payloads (not opaque stack traces).

---

## References

- Consumers summary: [`core/14-consumers.md`](./core/14-consumers.md)
- REST plan (often under MCP): [`plan-rest.md`](./plan-rest.md)
- CLI (alternative surface): [`plan-cli.md`](./plan-cli.md)
- Brainstorm library + hooks philosophy: [`brainstorm/06-libreria-adapters-cli.md`](./brainstorm/06-libreria-adapters-cli.md)
