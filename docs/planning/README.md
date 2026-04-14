# Planning

Roadmap, monorepo layout, known gaps, and planned or shipped consumer surfaces (REST, CLI, MCP). Normative engine behavior stays in **[`docs/core/`](../core/README.md)**.

**Hub:** **[Documentation index](../README.md)** · **[Getting started](../getting-started.md)**

**Runnable stack (Docker, no pnpm):** root **[README](../../README.md#easy-getting-started-runnable-stack)** — **`@opencoreagents/runtime`** + Compose; detail in **[`apps/runtime/README.md`](../../apps/runtime/README.md)**.

---

## Suggested reading order

1. **[Agent Engine overview](./agent-engine-overview.md)** — product narrative: loop, invariants, dynamic definitions, consumers; read alongside **[Getting started](../getting-started.md)**.
2. **[Implementation plan](./plan.md)** — phased build-out, progress snapshot, Phase 0 bootstrap order.
3. **[MVP](./mvp.md)** — minimum engine scope, adapter choices, risks, suggested build order (normative contracts in `docs/core/`).
4. **[Scaffold](./scaffold.md)** — package map, file tree, implementation detail (large reference).
5. **[Technical debt](./technical-debt.md)** — hub; deferrals split by priority (**[security & production](./technical-debt-security-production.md)**, **[platform / core / CI](./technical-debt-platform-core-ci.md)**, **[deferred (examples, OSS)](./technical-debt-deferred.md)**).
6. Surface docs as needed: **[REST](./plan-rest.md)**, **[CLI](./plan-cli.md)**, **[MCP](./plan-mcp.md)**.

---

## Documents

| Document | Contents |
|----------|----------|
| [Agent Engine overview](./agent-engine-overview.md) | Full product narrative; loop; consumers (SDK / REST / MCP); links to `docs/core/` |
| [Implementation plan](./plan.md) | Phased monorepo build-out; gates; dependency graph |
| [MVP](./mvp.md) | Engine MVP scope, persistent adapters, risks, implementation order |
| [Scaffold](./scaffold.md) | Package map, file tree, implementation phases |
| [Technical debt](./technical-debt.md) | Hub; intentional deferrals and gaps (see child files by priority) |
| [Technical debt — security & production](./technical-debt-security-production.md) | Sections **1–3**: security, multi-worker, host checklist |
| [Technical debt — platform / core / CI](./technical-debt-platform-core-ci.md) | Sections **1–4**: packages, engine, tests, ops |
| [Technical debt — deferred](./technical-debt-deferred.md) | Sections **1–4**: examples, CLI, docs, OSS |
| [REST](./plan-rest.md) | HTTP/JSON contract + **`@opencoreagents/rest-api`** |
| [**Runnable stack** (`apps/runtime`)](../../apps/runtime/README.md) | **`@opencoreagents/runtime`**: Docker Compose (Redis + API + worker); guides in **`apps/runtime/docs/`** |
| [CLI](./plan-cli.md) | Command-line surface beyond **`init` / `generate`** |
| [MCP](./plan-mcp.md) | Model Context Protocol as a channel |

Early ideation and brainstorm notes live under **[`docs/brainstorm/`](../brainstorm/)** (non-normative).
