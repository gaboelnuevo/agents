# Technical debt — deferred (examples, docs housekeeping, OSS)

Lower-priority follow-ups: **sample apps**, **generator placeholders**, **documentation hygiene**, and **community / legal** polish. Triage [security & production](./technical-debt-security-production.md) and [platform / core / CI](./technical-debt-platform-core-ci.md) first.

**Hub:** [`technical-debt.md`](./technical-debt.md)

---

## 1. Examples and non-production samples

| Item | Notes |
|------|--------|
| **`@opencoreagents/rag` + `examples/rag`** | Per-project catalog: **`registerRagCatalog(runtime, projectId, sources)`** from **`@opencoreagents/rag`** (or **`AgentRuntime.registerRagCatalog`**) after **`registerRagToolsAndSkills()`**. **`fileReadRoot`** can default on **`AgentRuntime`** (session overrides). **`examples/rag`** uses **`createDemoVectorAdapter()`** (in-memory, single-process) and permissive demo **`security.roles`** — **not** production. Ship a **durable** **`VectorAdapter`**, explicit embedding model + **dimensions** config, and minimal roles for real traffic. |
| **`examples/load-openclaw-skills`** | Keyless demo: **`loadOpenClawSkills`**, **`registerOpenClawExecTool`**, **`defaultSkillIdsGlobal`** for shared OpenClaw skill ids, scripted mock LLM. Not production (**`exec`**, broad tool exposure). Prompt still merges skill text manually — see **`ContextBuilder` + skill / OpenClaw text** in [platform / core / CI](./technical-debt-platform-core-ci.md) §2. |
| **REST sample smoke (optional CI)** | No CI job today that **`curl`**s a live **[`examples/plan-rest-express`](../../examples/plan-rest-express/)** process; **`packages/rest-api`** is covered by **`pnpm test`** only. Add only if you want an extra integration smoke beyond unit tests. |

---

## 2. CLI and scaffold

| Item | Notes |
|------|--------|
| **Placeholder copy in generators** | [`generate.ts`](../../packages/scaffold/src/generate.ts) emits `TODO: describe what this tool does.` / `TODO: describe this skill.` in generated files — intentional placeholders for the user to replace. |
| **Template parity** | Not all CLI templates may exercise every runtime path (e.g. `runStore`, `onWait`); align templates with [`07-definition-syntax.md`](../core/07-definition-syntax.md) over time. |

---

## 3. Documentation

| Item | Notes |
|------|--------|
| **Brainstorm vs `docs/core/`** | Older material under `docs/brainstorm/` may diverge from canonical `docs/core/` — treat `docs/core/` as source of truth. |
| **REST / MCP product APIs** | [14-consumers.md](../core/14-consumers.md) describes patterns. **Reference samples:** [`@opencoreagents/rest-api`](../../packages/rest-api/) + [`examples/plan-rest-express/`](../../examples/plan-rest-express/) — routes per **`plan-rest.md`** (sync inline or **`dispatch`**); **`plan-rest-express`** enables **`swagger`** (**`GET /openapi.json`**, **`GET /docs`**) for a live OpenAPI doc. [`examples/dynamic-runtime-rest/`](../../examples/dynamic-runtime-rest/) — Redis definitions + BullMQ + per-job hydrate. **Shared gaps across samples:** **no rate limits**, not a substitute for product authZ (see [Security §1](./technical-debt-security-production.md#1-security-integrity-and-production-readiness)). **`rest-api`**-specific: **`resolveApiKey`** / **`apiKey`**; multi-tenant **`projectId`** **spoofable** without **`resolveProjectId`**; **`GET /runs`** + shared **`RunStore`** (**`run.projectId`** check when set — [Platform §1](./technical-debt-platform-core-ci.md#1-platform-and-packages) / [Security §1](./technical-debt-security-production.md#1-security-integrity-and-production-readiness)); **public OpenAPI/Swagger** unless the host wraps the router ([Platform §1](./technical-debt-platform-core-ci.md#1-platform-and-packages)). **`dispatch`** mode still needs a **worker** with the same queue + **`RunStore`** semantics as **`dynamic-runtime-rest`**. **`dynamic-runtime-rest`:** **no JSON-schema validation** on PUT bodies (casts only), fixed **`PROJECT_ID`** unless extended. **`_secrets`** on HTTP-tool PUT applies **only** to the API process; workers use **`HTTP_TOOL_SECRETS_JSON`** — invalid JSON there yields **empty** secrets (silent). Canonical flow: [`core/21-dynamic-runtime-rest.md`](../core/21-dynamic-runtime-rest.md). Roadmaps: [`plan-rest.md`](./plan-rest.md), [`plan-mcp.md`](./plan-mcp.md). |
| **`docs/planning/scaffold.md` size** | Very long single file — fine as reference; for ongoing changes, splitting or doc-only PRs can ease review. |

---

## 4. Open source and community

Items expected for a **public** OSS project (adoption, legal clarity, responsible disclosure). **CI** is already in place ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)); the rest is **not** a substitute for [Security §1](./technical-debt-security-production.md#1-security-integrity-and-production-readiness) / [Security §3](./technical-debt-security-production.md#3-production-architecture-checklist-host--operator) (runtime security stays in the host).

| Item | Notes |
|------|--------|
| **Root `LICENSE`** | Repo root has a **`LICENSE`** file — keep it aligned with **`"license"`** in published **`package.json`** files (**SPDX** id) before npm releases. |
| **`license` in `package.json`** | Workspace packages should declare **`"license"`** (and keep **private** vs **publish** flags consistent) for anything shipped to **npm** or other registries. |
| **`CONTRIBUTING.md`** | How to clone, **`pnpm install`**, **`build` / `test` / `lint`**, branch/PR expectations, scope of the monorepo — lowers friction for external contributors. |
| **`SECURITY.md`** | Vulnerability reporting path (e.g. GitHub **Security** → **Advisories**, or a dedicated security contact); separate from [`08-scope-and-security.md`](../core/08-scope-and-security.md) (engine semantics). |
| **`CODE_OF_CONDUCT.md`** | Optional but standard for community-run repos (e.g. Contributor Covenant). |
| **Releases and semver** | **`CHANGELOG.md`** and/or GitHub **Releases** when publishing versioned packages; align with [Platform §1](./technical-debt-platform-core-ci.md#1-platform-and-packages) adapter/API stability expectations. |
| **Issue / PR templates** | Optional: bug vs feature, Node/pnpm versions — reduces incomplete reports. |
