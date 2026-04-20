# `@opencoreagents/code-skills`

Install OpenCore Agents skills for coding assistants.

## Install

```bash
npx @opencoreagents/code-skills add opencoreagents-engine
```

Installs `SKILL.md` packs to `./.skills/` in your current repository, so Claude Code, Codex, Cursor, and other assistants can load project-local skills.

## Usage

```bash
# Install a specific skill
npx @opencoreagents/code-skills add opencoreagents-engine

# Install in a custom assistant directory
npx @opencoreagents/code-skills add opencoreagents-engine --dir .claude/skills

# Install all four skills
npx @opencoreagents/code-skills add opencoreagents-workspace
npx @opencoreagents/code-skills add opencoreagents-engine
npx @opencoreagents/code-skills add opencoreagents-rest-workers
npx @opencoreagents/code-skills add opencoreagents-rag-dynamic

# List available skills
npx @opencoreagents/code-skills list

# Show help
npx @opencoreagents/code-skills --help
```

## Available Skills

| Skill | Use when |
|-------|----------|
| `opencoreagents-workspace` | Repo map, Turbo/pnpm, where docs live |
| `opencoreagents-engine` | `@opencoreagents/core`, adapters, run loop |
| `opencoreagents-rest-workers` | `rest-api`, BullMQ, dynamic-runtime patterns |
| `opencoreagents-rag-dynamic` | `@opencoreagents/rag`, catalogs, file/vector tools |

Each skill contains a `SKILL.md` with YAML frontmatter (`name`, `description`) plus focused instructions and bundled docs from this monorepo.

## What is this?

This package ships **documentation skills** (not runtime `Skill.define` entries) for AI coding assistants. After installing via `npx add`, the skills live in your repository and provide context about:

- The OpenCore Agents monorepo layout
- The core engine (`AgentRuntime`, `Agent.load`, `RunBuilder`)
- REST API and BullMQ worker patterns
- RAG and dynamic catalog tools

## Layout (per skill)

- **`SKILL.md`** — Entry point with skill metadata and instructions
- **`docs/`** — Markdown docs from the monorepo
- **`packages/`** — README stubs for cross-references

Skills ship under `dist/skills/<id>/` in the npm package.

## API (programmatic)

```typescript
import {
  skillsDirectory,
  skillIds,
  skillDocsDirectory,
  skillPackagesDirectory,
} from "@opencoreagents/code-skills";

skillDocsDirectory("opencoreagents-engine");      // → .../skills/opencoreagents-engine/docs
skillPackagesDirectory("opencoreagents-engine");  // → .../skills/opencoreagents-engine/packages
```

## Development

```bash
# Build the package (generates docs/ and packages/ for each skill)
pnpm build --filter=@opencoreagents/code-skills

# Clean generated files
pnpm clean --filter=@opencoreagents/code-skills
```

Build runs `tsup` then `scripts/copy-pack.mjs`, which hydrates each skill's `docs/` and `packages/` before copying to `dist/skills/`.
