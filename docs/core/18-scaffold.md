# Scaffold: project and agent bootstrapping

CLI and programmatic helpers that generate the **initial directory structure**, configuration files, and starter definitions for a new project or agent. Scaffolding produces files — the **engine** and **adapters** remain unchanged.

Related: [07-definition-syntax.md](./07-definition-syntax.md) (what gets generated), [14-consumers.md](./14-consumers.md) (CLI consumer), [05-adapters.md](./05-adapters.md) (adapter config templates). Monorepo package layout and implementation phases: [`../scaffold.md`](../scaffold.md) (not duplicated here).

---

## 1. Design principles

| Principle | Detail |
|-----------|--------|
| **Convention over configuration** | Sensible defaults for directory layout, adapter selection, and LLM provider so a new project runs immediately. |
| **Override everything** | Every default can be changed via flags, env vars, or the generated config file after scaffolding. |
| **No runtime coupling** | Scaffold output is plain files; the engine reads them the same way as hand-written ones. |
| **Idempotent where possible** | Re-running scaffold on an existing project adds missing pieces without overwriting user edits (unless `--force`). |

---

## 2. CLI commands

### 2.1 `init` — project scaffold

Creates the project root structure and base configuration.

```bash
npx @agent-runtime/cli init my-project
```

The package exposes the `agent-runtime` executable (`package.json` `bin`); after a local or global install you can run `agent-runtime init my-project` the same way.

| Flag | Default | Effect |
|------|---------|--------|
| `--template` | `default` | Starter template (`default`, `minimal`, `multi-agent`). |
| `--adapter` | `upstash` | Primary adapter preset (`upstash`, `redis`, `memory`). |
| `--llm` | `openai` | Default LLM provider (`openai`, `anthropic`, `custom`). |
| `--package-manager` | auto-detect | `npm`, `pnpm`, or `yarn`. |
| `--force` | `false` | Overwrite existing files. |
| `--out` | `<cwd>/<name>` | Project root directory (absolute or relative to cwd). |

### 2.2 `generate agent` — agent definition

Adds a new agent definition and optional supporting files.

```bash
npx @agent-runtime/cli generate agent support-bot
```

| Flag | Default | Effect |
|------|---------|--------|
| `--cwd` | current directory | Project root containing `agents/`, `tools/`, etc. |
| `--skills` | `[]` | Comma-separated skill ids to include. |
| `--tools` | `save_memory`, `get_memory` | Comma-separated tool ids (omit flag entirely for this default). |
| `--llm-model` | `gpt-4o` | Model id written into the generated agent file. |
| `--with-test` | `true` | Generate `tests/<agent>.test.ts` (use `--no-with-test` to skip). |
| `--force` | `false` | Overwrite existing files. |

### 2.3 `generate tool` — tool definition + handler stub

```bash
npx @agent-runtime/cli generate tool send-email
```

Generates the `Tool.define` call with placeholder `inputSchema` and an empty handler module.

| Flag | Default | Effect |
|------|---------|--------|
| `--cwd` | current directory | Project root. |
| `--force` | `false` | Overwrite an existing tool file. |

### 2.4 `generate skill` — skill definition

```bash
npx @agent-runtime/cli generate skill intake-summary --tools save_memory,get_memory
```

Generates the `Skill.define` call referencing the listed tools.

| Flag | Default | Effect |
|------|---------|--------|
| `--cwd` | current directory | Project root. |
| `--tools` | `[]` | Comma-separated tool ids. |
| `--force` | `false` | Overwrite an existing skill file. |

---

## 3. Generated directory structure

After `init my-project` with the `default` template:

```
my-project/
├── agents/
│   └── example-agent.ts       → Agent.define + Agent.load starter
├── tools/
│   └── save-memory.ts         → Tool.define + handler stub
├── skills/
│   └── example-skill.ts       → Skill.define stub
├── config/
│   ├── runtime.ts             → adapter factory, LLM config, memory config
│   └── security.ts            → SecurityLayer defaults, roles
├── tests/
│   └── example-agent.test.ts  → vitest/jest starter
├── .env.example               → required env vars (API keys, Redis URL)
├── tsconfig.json
├── package.json               → @agent-runtime/core + dev deps
└── README.md                  → quickstart instructions
```

### `minimal` template

Omits `skills/`, `config/security.ts`, and tests. Single `agent.ts` at the root with inline config.

### `multi-agent` template

Adds `agents/` with two sample agents, `config/message-bus.ts` for inter-agent communication ([09-communication-multiagent.md](./09-communication-multiagent.md)), and a shared `skills/` directory.

---

## 4. Configuration file (`config/runtime.ts`)

The scaffold generates a typed config that the engine reads at startup.

```typescript
import { RuntimeConfig } from "@agent-runtime/core";

export default {
  adapters: {
    memory: {
      type: "upstash-redis",
      url: process.env.UPSTASH_REDIS_URL!,
      token: process.env.UPSTASH_REDIS_TOKEN!,
    },
    vector: {
      type: "upstash-vector",
      url: process.env.UPSTASH_VECTOR_URL,
      token: process.env.UPSTASH_VECTOR_TOKEN,
    },
    jobQueue: {
      type: "bullmq",
      connection: process.env.REDIS_URL,
    },
  },
  llm: {
    provider: "openai",
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY!,
  },
  security: {
    enabled: true,
    defaultRoles: ["agent"],
  },
  limits: {
    maxIterations: 25,
    runTimeoutMs: 120_000,
  },
} satisfies RuntimeConfig;
```

Each section maps to an adapter contract in [05-adapters.md](./05-adapters.md). Fields with `process.env` reference the generated `.env.example`.

---

## 5. Programmatic scaffold API

For tools that generate projects without the CLI (e.g. a dashboard or CI pipeline):

```typescript
import { scaffold } from "@agent-runtime/scaffold";

await scaffold.initProject({
  name: "my-project",
  path: "/tmp/my-project",
  template: "default",
  adapter: "upstash",
  llm: "openai",
});

await scaffold.generateAgent({
  projectPath: "/tmp/my-project",
  agentId: "support-bot",
  skills: ["intakeSummary"],
  tools: ["save_memory", "get_memory"],
});
```

Returns a manifest of created files for downstream processing.

---

## 6. Template engine

Templates live in **`@agent-runtime/scaffold`** (`packages/scaffold/src/templates/`), not in the CLI package. Each template is a **TypeScript module** (`default`, `minimal`, `multi-agent`) that returns a map of relative paths → file contents for a full project tree. Substitution (project name, adapter preset, LLM preset, package manager) is applied in code when building that map.

Keeping templates in the scaffold package lets the CLI stay a thin argv/exit-code wrapper and keeps one programmatic implementation for both CLI and embedders.

Variables and flags line up with the API described in §5:

| Variable / input | Source |
|------------------|--------|
| Project name | `init` positional or `initProject({ name })` |
| `adapter` / adapter preset | `--adapter` or `initProject({ adapter })` |
| `llm` / LLM preset | `--llm` or `initProject({ llm })` |
| `packageManager` | detected or flag / `initProject({ packageManager })` |
| `agentId` | `generate agent <id>` / `generateAgent({ agentId })` |
| `toolIds` | `--tools` / `generateAgent({ tools })` |
| `skillIds` | `--skills` / `generateAgent({ skills })` |

File-level structure of each template module is specified in [`../scaffold.md`](../scaffold.md) §1 (`packages/scaffold`).

---

## 7. Post-scaffold steps

After scaffolding, the CLI prints a checklist:

```
✓ Project created at ./my-project

  Next steps:
  1. cd my-project
  2. cp .env.example .env    ← fill in API keys
  3. npm install
  4. npm run dev              ← starts the agent with hot reload
```

`npm run dev` is wired to a watch-mode script that calls `Agent.load` + `agent.run` from the generated entry point.

---

## 8. Extending scaffold

| Extension point | Mechanism |
|-----------------|-----------|
| **Custom templates** | Drop a folder under `templates/` in the CLI package or pass `--template-dir` pointing to a local directory. |
| **Plugins** | A scaffold plugin exports `{ name, beforeGenerate?, afterGenerate? }` hooks. Registered in `package.json` under `"agentScaffoldPlugins"`. |
| **CI generators** | `scaffold.initProject` returns a file manifest; CI can diff against an expected baseline for regression testing. |

---

## 9. Relationship to other docs

| Doc | Connection |
|-----|------------|
| [07-definition-syntax.md](./07-definition-syntax.md) | Scaffold generates files that follow `Tool.define`, `Skill.define`, `Agent.define` syntax. |
| [05-adapters.md](./05-adapters.md) | `config/runtime.ts` maps to adapter contracts; `--adapter` flag selects the preset. |
| [08-scope-and-security.md](./08-scope-and-security.md) | `config/security.ts` bootstraps `SecurityLayer` defaults. |
| [14-consumers.md](./14-consumers.md) | The CLI `init` and `generate` commands are consumer-level operations. |
| [15-multi-tenancy.md](./15-multi-tenancy.md) | Multi-tenant scaffolds include `projectId` in generated definitions. |
