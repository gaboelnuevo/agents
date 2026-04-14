# CLI for `@opencoreagents/runtime`

From the repository root:

```bash
pnpm --filter @opencoreagents/runtime config:print
pnpm --filter @opencoreagents/runtime config:print config/local.yaml
pnpm --filter @opencoreagents/runtime config:env > apps/runtime/.env.stack
pnpm --filter @opencoreagents/runtime exec tsx src/cli.ts env config/cloud.yaml --strict
```

**Default config path** when none is passed: **`RUNTIME_CONFIG`**, or **`config/local.yaml`** relative to the current working directory.

**`config:print`** — merged + expanded JSON (can include secrets if expanded from env; see [security.md](./security.md)).

**`config:env`** — dotenv-style lines for wire settings + **`LLM_DEFAULT_PROVIDER`** (not raw LLM keys).

**`--strict`** — fails if `redis.url` is empty after expansion.
