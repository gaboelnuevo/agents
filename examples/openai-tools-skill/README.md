# OpenAI + tools + skill

Uses **`OpenAILLMAdapter`**, a **custom tool** (`roll_dice`), and a **skill** (`dice-skill`) that exposes that tool to the agent.

**Production:** memory is **`InMemoryMemoryAdapter`** here for a minimal demo. Use **`RedisMemoryAdapter`** / **`UpstashRedisMemoryAdapter`** when you need shared or persistent memory — [`examples/README.md`](../README.md#memory-in-production).

The engine parses **JSON in `message.content`** (`thought` | `action` | `result` | …). When OpenAI returns **`tool_calls`** with an empty `content`, **`executeRun`** (in `@agent-runtime/core`) maps the first call into an **`action`** step — use **`OpenAILLMAdapter`** directly, no wrapper class.

## Setup

```bash
# repository root: install and build workspace packages
pnpm install
pnpm turbo run build --filter=@agent-runtime/core --filter=@agent-runtime/adapters-openai
```

Copy env and add your key:

```bash
cd examples/openai-tools-skill
cp .env.example .env
# edit .env
```

Load env when running (shell):

```bash
set -a && source .env && set +a
pnpm start
```

Or one shot:

```bash
OPENAI_API_KEY=sk-... pnpm --filter @agent-runtime/example-openai-tools-skill start
```

## What it does

1. Registers **`roll_dice`** with `Tool.define` (global tool + `execute`).
2. Registers **`dice-skill`** with `Skill.define` (`tools: ["roll_dice"]`).
3. Defines **`demo-gamer`** with `skills: ["dice-skill"]`.
4. Runs one user message asking for a **d20** roll; prints the final **`result`** step if present.

## Costs

This calls the **OpenAI Chat Completions API** (paid). Use a small model via `OPENAI_MODEL` if you want lower cost.
