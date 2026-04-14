# Load OpenClaw skills example

**Runtime support for OpenClaw / AgentSkills skills** lives in **[`@opencoreagents/skill-loader-openclaw`](../../packages/skill-loader-openclaw/)**; **this package is the runnable demo** ([`src/main.ts`](./src/main.ts)).

Demonstrates **`loadOpenClawSkills`** and **`registerOpenClawExecTool`** from **`@opencoreagents/skill-loader-openclaw`**:

- Scans **`skills/*/`** for **`SKILL.md`** (OpenClaw / AgentSkills-style frontmatter + body).
- Prints **loaded** vs **skipped** (see **`gated_missing_bin`** — skipped when a required binary is absent).
- Registers the global **`exec`** tool (no shell; first token is the binary).
- Preloads loaded skill ids on **`AgentRuntime`** via **`defaultSkillIdsGlobal`** so agents need not list them again on **`Agent.define`**.
- Merges each skill’s description + instructions into **`Agent.define.systemPrompt`**. Today’s **`ContextBuilder`** only unions **tool ids** from skills; it does **not** append skill text, so this example inlines instructions explicitly (same effect OpenClaw aims for).

Uses a **scripted mock LLM** (no **`OPENAI_API_KEY`**). **`node`** must be on **`PATH`** so **`exec`** can run **`node -p 42`**.

**Where to get skills, install from ClawHub, and caveats:** see **[add-skills.md](./add-skills.md)**.

---

## Prerequisite

From the repository root:

```bash
pnpm install
pnpm turbo run build --filter=@opencoreagents/core --filter=@opencoreagents/skill-loader-openclaw
```

## Run

```bash
pnpm --filter @opencoreagents/example-load-openclaw-skills start
```

Or from this directory:

```bash
pnpm start
```

## Layout

| Path | Role |
|------|------|
| `skills/openclaw_demo/SKILL.md` | Eligible skill; instructs **`exec`** with **`node -p 42`** |
| `skills/gated_missing_bin/SKILL.md` | Skipped at load (missing gated binary in **`requires.bins`**) |

## Next steps

- Add more directories to **`loadOpenClawSkills({ dirs: [...] })`** (workspace → `~/.agents/skills` → `~/.openclaw/skills`, etc.).
- For production, tighten **`fileReadRoot`** / **`Session.fileReadRoot`** so **`exec`** **`cwd`** stays inside your sandbox.
