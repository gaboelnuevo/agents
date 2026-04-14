# Technical debt and known gaps

English-language register of **intentional deferrals**, **plan vs implementation gaps**, and **follow-up work** for the `@opencoreagents` monorepo. It complements [`plan.md`](./plan.md) (roadmap) and [`core/19-cluster-deployment.md`](../core/19-cluster-deployment.md) (cluster patterns).

The register is **split by triage priority**. **Examples and sample-app smoke tests** are grouped in the **deferred** doc so day-to-day hardening focuses on production and platform gaps first.

---

## Reading order (by priority)

| Priority | Document | Contents |
|----------|----------|----------|
| **1 — High** | **[`technical-debt-security-production.md`](./technical-debt-security-production.md)** | Security / integrity, multi-worker concurrency, host production checklist |
| **2 — Medium** | **[`technical-debt-platform-core-ci.md`](./technical-debt-platform-core-ci.md)** | Platform & packages, core engine, testing & CI, operations |
| **3 — Deferred** | **[`technical-debt-deferred.md`](./technical-debt-deferred.md)** | Examples & demos, CLI/scaffold, documentation housekeeping, OSS/community |

Each child file numbers major sections **1, 2, 3, …** from top to bottom.

---

## Snapshot (condensed)

Automated **CI** (`build` / `test` / `lint` on every push/PR) with **Redis** and **`REDIS_INTEGRATION=1`** for BullMQ — see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). **Per-tool timeout** (`toolTimeoutMs` on **`AgentRuntime`**, `ToolTimeoutError`), **session expiry** (`SessionOptions.expiresAtMs`, `SessionExpiredError` on **`run` / `resume` / `onWait`**), and **per-project RAG catalog** (`AgentRuntime.registerRagCatalog` / `@opencoreagents/rag`) are **implemented**. **`EngineConfig.defaultSkillIdsGlobal`** merges skill ids at **`buildEngineDeps`** (before each agent’s **`skills`**, deduped) so **`effectiveToolAllowlist`** and engine deps see shared skills without repeating them on every **`Agent.define`**. **Runtime REST router (library):** **`@opencoreagents/rest-api`** — **`createRuntimeRestRouter`** (Express); contract in **`plan-rest.md`**; residual gaps in [Security §1](./technical-debt-security-production.md#1-security-integrity-and-production-readiness) and [Platform §1](./technical-debt-platform-core-ci.md#1-platform-and-packages). **Dynamic definitions** and **Redis** stores are **shipped** — see [`core/21-dynamic-runtime-rest.md`](../core/21-dynamic-runtime-rest.md). **Phase 9** has **broad automated coverage** in **`packages/core/tests`** — see [`plan.md` — Progress snapshot](./plan.md); **still manual / optional:** full-stack **9.1** with **real OpenAI + TCP Redis** in CI, and **host-layer** checks for **9.4**-style security stories.

**Docs:** prompt tool visibility = **`effectiveToolAllowlist`** (agent **`skills`** + optional **`defaultSkillIdsGlobal`**, ∩ registry, then optional **`allowedToolIds`**); **`ContextBuilder.build()`** still does not inject skill descriptions / **`SKILL.md`** bodies into the prompt — hosts or examples merge text manually ([`11-context-builder.md`](../core/11-context-builder.md) §3, [`examples/load-openclaw-skills`](../../examples/load-openclaw-skills/)). **`SecurityContext` is not used inside `ContextBuilder.build()`** to hide tools yet ([`08-scope-and-security.md`](../core/08-scope-and-security.md) §2, [`11-context-builder.md`](../core/11-context-builder.md) §3).

**Where to look first:** multi-worker / tenancy / REST and store trust → [security & production](./technical-debt-security-production.md); adapters, `rest-api` mechanics, OpenAI adapter gaps, CI → [platform / core / CI](./technical-debt-platform-core-ci.md); samples and contributing polish → [deferred](./technical-debt-deferred.md).

---

## How to use this register

- **Triaging:** Prefer turning items into tracked issues with owners. Start with **[security & production](./technical-debt-security-production.md)** for anything that affects tenants, data, or exposed HTTP.
- **Closing entries:** Remove or move to “Done” only when the codebase or tests actually reflect the fix (not when docs alone change).

Last updated **2026-04-13**. Roadmap: [`plan.md` — Progress snapshot](./plan.md), [`plan-rest.md`](./plan-rest.md).
