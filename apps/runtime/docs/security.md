# Security for `@opencoreagents/runtime`

Operational guidance for secrets, Redis, and the HTTP surface. The runtime app does not replace your org’s platform controls (IAM, VPC, secret managers).

## Repository and files

- Only **`*.example.yaml`** templates belong in git. Operational stacks (`local.yaml`, `docker.stack.yaml`, `cloud.yaml`, …) are **gitignored**; still prefer **`${VAR}` placeholders** in those files and inject real values from the environment at runtime so disk backups and editor history carry less risk.
- **`pnpm config:print`** prints the **fully merged and expanded** config. If expansion inlined secrets from the environment, they can appear in stdout (CI logs, terminals). Treat that command like **`cat` of a secret file**.
- **`pnpm config:env`** emits wire settings and **`LLM_DEFAULT_PROVIDER`**; it does **not** add LLM API keys to the output. Do not add custom tooling that dumps raw `llm` keys into files checked into git.

## LLM and stack expansion

- **`llm.openai.apiKey`** / **`llm.anthropic.apiKey`** should be **`${OPENAI_API_KEY}`**-style references. The process reads the stack file, then **`expandDeep`** substitutes from **`process.env`**. Supply keys via your platform (secrets manager → env vars), not literals in committed YAML.
- After expansion, keys live in the **API and worker process memory** like any other app; restrict who can attach debuggers or read `/proc` on the host.

## Redis

- **`redis.url`** may include a password (`redis://user:pass@host:6379`). The worker startup log **redacts** userinfo; avoid logging full URLs elsewhere. TLS URLs are fine as a single string.
- **Definitions and agent memory** are stored in Redis under your **`project.id`** and **`definitions.keyPrefix`**. Protect Redis network access, enable AUTH/TLS in production, and scope ACLs if your provider supports them.

See also [why-redis.md](./why-redis.md) for why Redis is required and how to run it safely.

## HTTP tools (`{{secret:*}}`)

- **`HTTP_TOOL_SECRETS_JSON`**: JSON object of string secrets, read **only in the worker** (`src/workerSecrets.ts`). The API process also calls **`httpToolSecretsFromEnv()`** when syncing definitions to the in-memory registry, so provide the same variable on **both** processes if hydration needs those secrets at sync time. Never put these values inside agent definitions stored in Redis or inside **BullMQ job payloads** (jobs are persisted).

## Public HTTP API

- **`REST_API_KEY`:** when set (non-empty), **plan REST** (`/agents`, `/jobs`, …) and **`/v1/*`** require **`Authorization: Bearer <key>`** or **`X-Api-Key: <key>`** (same as **`resolveApiKey`** in **`@opencoreagents/rest-api`**). **`GET /health`** stays **unauthenticated** by design (minimal JSON).
- **Listen address:** when **`REST_API_KEY`** is **unset or empty**, the API process binds **`127.0.0.1` only** — nothing on the LAN/internet can open a TCP connection to the port from another machine (only same-host `localhost`). When **`REST_API_KEY`** is set, the server uses your stack’s **`server.host`** (often **`0.0.0.0`** in containers). **Do not** rely on the lab-only escape hatch **`OPENCORE_INSECURE_PUBLIC_HTTP=1`** (logs a warning).
- **Docker Compose** in this repo sets a **default** **`REST_API_KEY`** so the service can bind on all interfaces inside the container and published ports work; **change it** for anything beyond casual local use. Call APIs with the same key (e.g. Swagger **Authorize**, or **`curl -H "X-Api-Key: …"`**).
- **`GET /openapi.json`** and **`GET /docs`** are outside the API-key middleware in the library; when bound to **`0.0.0.0`**, those URLs are reachable without a key — put the app behind a gateway or restrict the network if that matters.
- For production, store **`REST_API_KEY`** in a secret manager and prefer a **reverse proxy**, **mTLS**, or **private networking**.
