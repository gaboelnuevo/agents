# Run on the host (Node, no API/worker images)

This path runs the **HTTP server** and **BullMQ worker** as normal **Node** processes on your machine. You still need **Redis** somewhere reachable (often a **Redis-only** Docker container while the app runs on the host).

For **API + worker + Redis** all in Compose, use [docker.md](./docker.md) instead.

---

## Prerequisites

- **Node.js** and **pnpm** (see the monorepo root for versions).
- A clone of this repository.

---

## 1. Config file: `config/local.yaml`

The runtime loads a single stack file:

- **Default path:** **`config/local.yaml`** resolved from the process **current working directory** (`process.cwd()`).
- **Override:** set **`RUNTIME_CONFIG`** to a **relative or absolute path** to another YAML/JSON stack (same format as Docker’s `docker.stack.yaml`).

From **`apps/runtime`**:

```bash
cp config/local.example.yaml config/local.yaml
```

Edit **`local.yaml`**: **`project.id`**, **`definitions.keyPrefix`**, **`llm`**, etc. The template points **`redis.url`** at **`redis://127.0.0.1:6379`** — use that if Redis listens on localhost (typical when Redis runs in Docker with a published port). Full reference: [configuration.md](./configuration.md).

**Important:** Start the server and worker from a cwd where **`config/local.yaml`** exists, **or** set **`RUNTIME_CONFIG`** to the real path. Recommended:

```bash
cd apps/runtime
```

Then use **`pnpm start:server`** / **`pnpm start:worker`** here, **or** from the repo root:

```bash
pnpm --filter @opencoreagents/runtime start:server
pnpm --filter @opencoreagents/runtime start:worker
```

(`pnpm --filter …` runs scripts with **`apps/runtime`** as the package directory, so **`config/local.yaml`** resolves correctly.)

---

## 2. Environment variables (secrets and HTTP auth)

The stack file is merged, then **`${VAR}`** placeholders are expanded from **`process.env`** (see [configuration.md](./configuration.md)).

- **LLM:** export **`OPENAI_API_KEY`** / **`ANTHROPIC_API_KEY`** (or whatever names you used in **`llm.*.apiKey`** in YAML). **`pnpm config:env` does not print these keys** — it only helps with wire settings like port and Redis URL.
- **HTTP API:** **`REST_API_KEY`** — if **unset or empty**, the server binds **`127.0.0.1`** only (good for local dev). If **set**, the server uses **`server.host`** from the stack (often **`0.0.0.0`**). Unlike Compose, nothing sets a default key on the host — you choose. Details: [security.md](./security.md).

Use the **same** env in **both** terminals (server and worker) for LLM and shared settings.

---

## 3. Redis

The worker and API need Redis at the URL in your stack (default template: **`127.0.0.1:6379`**).

**Option A — Redis in Docker, app on host**

From **`apps/runtime`**:

```bash
docker compose -f docker-compose-with-redis.yml up -d redis
```

Or from the **repository root**:

```bash
docker compose -f apps/runtime/docker-compose-with-redis.yml up -d redis
```

**Option B — Redis installed on the host** — point **`redis.url`** in **`local.yaml`** at that instance. Background: [why-redis.md](./why-redis.md).

---

## 4. Install and build (monorepo)

From the **repository root**:

```bash
pnpm install
pnpm turbo run build --filter=@opencoreagents/runtime...
```

This pulls workspace dependencies and builds **`@opencoreagents/runtime`** and what it needs.

---

## 5. Optional: `pnpm config:env`

Some tools only read **`process.env`**. From **`apps/runtime`** you can print wire-related exports (port, Redis URL, queue name, **`LLM_DEFAULT_PROVIDER`**, etc.):

```bash
pnpm config:env
```

The **server and worker do not require** this step — they read the stack file directly. Use **`config:env`** when you want to **`source`** or copy values into another process.

---

## 6. Start server and worker (two processes)

Use **two terminals**, same env (export keys in both, or use a single **`.env`** loader your shell supports).

From **`apps/runtime`**:

```bash
pnpm start:server
```

```bash
pnpm start:worker
```

Equivalent from **repository root**:

```bash
pnpm --filter @opencoreagents/runtime start:server
pnpm --filter @opencoreagents/runtime start:worker
```

Then open [http://localhost:3010/health](http://localhost:3010/health) (port follows **`server.port`** in **`local.yaml`** unless overridden). **`/docs`** — use **Authorize** with **`REST_API_KEY`** when that variable is set.

---

## Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `Config file not found: …/config/local.yaml` | Wrong **cwd** or missing **`local.yaml`** — **`cd apps/runtime`**, copy from **`local.example.yaml`**, or set **`RUNTIME_CONFIG`**. |
| Redis connection errors | Redis not running, or **`redis.url`** in **`local.yaml`** does not match where Redis listens (host/port). |
| LLM errors after expansion | Missing **`OPENAI_API_KEY`** / **`ANTHROPIC_API_KEY`** (or wrong placeholder names in YAML). |
