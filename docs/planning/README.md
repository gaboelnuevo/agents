# Planning

Roadmap, monorepo layout, known gaps, and planned or shipped consumer surfaces (REST, CLI, MCP). Normative engine behavior stays in **[`docs/core/`](../core/README.md)**.

**Hub:** **[Documentation index](../README.md)** · **[Getting started](../getting-started.md)**

---

## Suggested reading order

1. **[Implementation plan](./plan.md)** — phased build-out, progress snapshot, Phase 0 bootstrap order.
2. **[Scaffold](./scaffold.md)** — package map, file tree, implementation detail (large reference).
3. **[Technical debt](./technical-debt.md)** — hub; deferrals split by priority (**[security & production](./technical-debt-security-production.md)**, **[platform / core / CI](./technical-debt-platform-core-ci.md)**, **[deferred (examples, OSS)](./technical-debt-deferred.md)**).
4. Surface docs as needed: **[REST](./plan-rest.md)**, **[CLI](./plan-cli.md)**, **[MCP](./plan-mcp.md)**.

---

## Documents

| Document | Contents |
|----------|----------|
| [Implementation plan](./plan.md) | Phased monorepo build-out; gates; dependency graph |
| [Scaffold](./scaffold.md) | Package map, file tree, implementation phases |
| [Technical debt](./technical-debt.md) | Hub; intentional deferrals and gaps (see child files by priority) |
| [Technical debt — security & production](./technical-debt-security-production.md) | Sections **1–3**: security, multi-worker, host checklist |
| [Technical debt — platform / core / CI](./technical-debt-platform-core-ci.md) | Sections **1–4**: packages, engine, tests, ops |
| [Technical debt — deferred](./technical-debt-deferred.md) | Sections **1–4**: examples, CLI, docs, OSS |
| [REST](./plan-rest.md) | HTTP/JSON contract + **`@opencoreagents/rest-api`** |
| [CLI](./plan-cli.md) | Command-line surface beyond **`init` / `generate`** |
| [MCP](./plan-mcp.md) | Model Context Protocol as a channel |

Early ideation and Spanish brainstorm notes live under **[`docs/brainstorm/`](../brainstorm/)** (non-normative).
