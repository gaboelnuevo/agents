# Cloud deployment for `@opencoreagents/runtime`

1. Provision **Redis** (TLS URL in **`redis.url`** is fine) — [why-redis.md](./why-redis.md).
2. Align **`REDIS_URL`**, **`PROJECT_ID`**, **`ENGINE_QUEUE_NAME`**, and **`DEF_KEY_PREFIX`** across every API and worker replica.
3. Prefer **`RUNTIME_CONFIG`** pointing at a mounted config file or a baked image layer; alternatively inject env overrides only for operational wire keys.
4. Set **`OPENAI_API_KEY`** / **`ANTHROPIC_API_KEY`** (or equivalent) on workers so **`llm`** resolves after placeholder expansion.

**OpenClaw:** with **`openclaw.enabled: true`** and non-empty **`openclaw.skillsDirs`**, **API and worker** both run the same bootstrap (`src/runtimeShared.ts`) so disk **`SKILL.md`** skills register in-process the same way; the worker spreads **`openClawAgentRuntimeSlice`** into **`AgentRuntime`** as **`defaultSkillIdsGlobal`**. If the API later runs the engine in-process, it must use the same slice. Mount the same skill directories into **every** API and worker replica (or bake paths into the image). **`config:env`** still emits **`OPENCLAW_*`** hints for other tooling.

**Programmatic use:** import **`loadRuntimeConfig`** / **`loadStackRuntime`** via **`workspace:*`** or relative paths from this package.
