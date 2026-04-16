# Configuration for `@opencoreagents/runtime`

## Model

Stack configuration is **declarative** (YAML or JSON) with **`${VAR}`** / **`${VAR:-default}`** expansion (see `src/expandPlaceholders.ts`).

- **Committed templates** only (`*.example.yaml`): `config/local.example.yaml`, `config/cloud.example.yaml`, **`config/docker.stack.example.yaml`**.
- **Operational** files (`local.yaml`, **`docker.stack.yaml`**, …) are **gitignored** (`config/*.yaml` except `*.example.yaml`). **`docker-compose-with-redis.yml`** bind-mounts **`config/docker.stack.yaml`** into API and worker (**create it from the example before first `up`**).
- **`configToProcessEnv`** (CLI `config:env`) and **`resolveStackWireSettings`** (`src/stackWire.ts`) apply the **same** wire rules so exported env matches what server/worker use for port, Redis URL, queue name, etc.

A small **CLI** (`src/cli.ts`) prints merged config or emits dotenv lines.

## `loadStackRuntime()`

Primary source for port, Redis URL, project id, definition key prefix, BullMQ queue name, run wait timeout: merged stack file (**`RUNTIME_CONFIG`** or **`config/local.yaml`**). Optional **env overrides** when set and non-empty: `PORT`, `PROJECT_ID`, `REDIS_URL`, `DEF_KEY_PREFIX`, `ENGINE_QUEUE_NAME`, `RUN_WAIT_TIMEOUT_MS` / `RUN_SYNC_TIMEOUT_MS`.

**`llm`** (providers, keys, `defaultProvider`) comes only from the stack file + expansion — not from ad-hoc env keys beyond `${VAR}` in YAML. **`pnpm config:env`** emits **`LLM_DEFAULT_PROVIDER`** only (not LLM API keys).

## Files

From `apps/runtime`:

```bash
cp config/local.example.yaml config/local.yaml
cp config/cloud.example.yaml config/cloud.yaml
```

For Docker Compose in this repo: **`cp config/docker.stack.example.yaml config/docker.stack.yaml`** and edit; Compose mounts that file (see [docker.md](./docker.md)).

| Committed template | Your file (typical, gitignored) | Purpose |
|--------------------|----------------------------------|---------|
| `config/local.example.yaml` | `config/local.yaml` | Host; Redis `127.0.0.1:6379` in template. Default when **`RUNTIME_CONFIG`** unset. |
| `config/docker.stack.example.yaml` | **`config/docker.stack.yaml`** (required for bundled Compose) | Mounted into API/worker; **`redis.url`** usually **`redis://redis:6379`**. |
| `config/cloud.example.yaml` | `config/cloud.yaml` | **`${REDIS_URL}`**, **`project.id`** from **`${PROJECT_ID:-default}`**, longer timeouts. |

**Placeholders:** **`${REDIS_URL}`**; **`${REDIS_URL:-redis://127.0.0.1:6379}`**. Paths under `openclaw.skillsDirs` resolve **relative to the config file’s directory**.

## Application entrypoints

| Script | Source | Role |
|--------|--------|------|
| `pnpm start:server` | `src/server.ts` | HTTP: **`GET /health`** (minimal JSON; **`?details=1`** adds **`projectId`** + queue), plan REST, **`/v1` → Redis** definitions admin (**`GET/PUT/DELETE`** on **`/v1/http-tools`**, **`/v1/skills`**, **`PUT`** on **`/v1/agents`**). Same **`createDefinitionsRedisStore`**, OpenClaw bootstrap, and **`definitionsSyncOptions`** as worker (`src/runtimeShared.ts`). |
| `pnpm start:worker` | `src/worker.ts` | BullMQ consumer; optional **OpenClaw** disk skills → **`defaultSkillIdsGlobal`**; **`loadStackRuntime`** + **`buildLlmStackFromConfig`**. |
| `pnpm config:*` | `src/cli.ts` | Print config or emit env lines. |

## `llm` (worker)

- **`defaultProvider`**: `openai` \| `anthropic` — needs a non-empty API key after expansion.
- **`openai` / `anthropic`**: **`${OPENAI_API_KEY}`** / **`${ANTHROPIC_API_KEY}`** style; optional `baseUrl`.

Agents pick **`llm.provider`** from stored JSON. If `config/local.yaml` is missing, the loader suggests copying **`config/local.example.yaml`**.

## OpenClaw (`openclaw` in stack file)

If you omit the whole **`openclaw`** block, the merge defaults are **`enabled: true`** and **`skillsDirs: ["./skills"]`** (paths resolve from the stack file’s directory). For **`config/local.yaml`**, **`../skills`** points at **`apps/runtime/skills`** in this repo.

When **`openclaw.enabled`** is **`true`** and **`openclaw.skillsDirs`** lists one or more directories (paths **relative to the stack file’s directory** are resolved at config load), **both** **`server.ts`** and **`worker.ts`** call **`bootstrapOpenClawSkills`** (`src/openclawBootstrap.ts`, re-exported from **`src/runtimeShared.ts`**) at startup: each subfolder with a **`SKILL.md`** is a skill, registered with **`scope: "project"`** and your stack **`project.id`**. That keeps the in-process skill registry aligned between API and worker before Redis-backed definitions are replayed.

The **worker** spreads **`openClawAgentRuntimeSlice(openclaw)`** into **`new AgentRuntime({ … })`** (with **`RUNTIME_AGENT_ENGINE_DEFAULTS`**) so **`defaultSkillIdsGlobal`** merges disk skills on every run (before each agent’s **`skills`** from Redis). That object also sets **`maxParseRecovery`** (default **4**, over the core library’s **1**) so planner/chat jobs tolerate occasional invalid JSON from the model before failing; set **`RUNTIME_ENGINE_MAX_PARSE_RECOVERY`** (integer **0–20**) to override. The HTTP API does not construct **`AgentRuntime`** yet; **`server.ts`** still computes the same slice so startup logs stay aligned and you can reuse it when adding in-process dispatch — **must** match the worker or skill merge diverges.

If **at least one** skill loads, **each** process that runs bootstrap also calls **`registerOpenClawExecTool()`** (global **`exec`** tool). Skills do **not** automatically add **`exec`** to each agent’s tool allowlist — for skills that run binaries/scripts, include **`"exec"`** in that agent’s **`tools`** array in **`/v1`** (same as [examples/load-openclaw-skills](../../examples/load-openclaw-skills/)).

Mount or bake the **same** skill directories into **every API and worker** replica. Plan REST and **`/v1`** stay Redis-backed for agents/skills stored there.

See [cloud.md](./cloud.md) for multi-replica notes.
