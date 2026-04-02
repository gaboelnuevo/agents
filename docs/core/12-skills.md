# Skills vs tools

**Tools** are effects executed by **ToolRunner**. **Skills** are **higher-level capabilities**: they group intent, auxiliary prompts, and/or tool references; the runtime resolves them **before** or **alongside** the loop; they do not replace the `Step` protocol.

Persisted definitions: [07-definition-syntax.md](./07-definition-syntax.md) (`Skill.define`). Execution adapters: [05-adapters.md](./05-adapters.md).

---

## 1. Tool (reminder)

- Stable name, runtime `execute`, optional `inputSchema`.
- The LLM invokes via `action` → engine validates and **ToolRunner** executes.
- Side effects **only** here (memory, HTTP, bus, etc.).

---

## 2. Skill (what it is)

A skill is:

- A reusable **id** (`intakeSummary`, `summarize`).
- Metadata: name, description, `tools` it may use, roles/scopes.
- **One of** (or a bounded combination):
  - **Declarative**: documentation + suggested tool list; Context Builder injects extra instructions when the skill is “active”.
  - **Template**: system/user fragments the builder concatenates if the run declares `activeSkill` or the agent has a default skill.
  - **Imperative**: `execute({ input, context })` function invoked by the **engine** at an explicit step (not necessarily by the LLM).

Skills must **not** be a second parallel execution path outside the loop: they materialize as **text to the LLM** or as a **documented internal action**.

---

## 3. Does the LLM “see” skills?

| Approach | Behavior |
|----------|----------|
| **Tools only in prompt** | The model only sees tools; skills are internal config that changes system prompt or tool subset. |
| **Listed skills** | Context includes available skills and when to use them; `Step` remains `thought` / `action` / `wait` / `result`. |
| **Skill as tool** | Antipattern except in narrow cases: `invoke_skill` duplicates the loop’s role. |

Core recommendation: **skills shape context and the tool allowlist**; the LLM still emits only standard **`Step`** JSON.

---

## 4. Runtime resolution

1. Load `AgentDefinition` with `skills: ["id1", "id2"]`.
2. Resolve each id against store **project → global** ([08-scope-and-security.md](./08-scope-and-security.md)).
3. Union tools referenced by all resolved skills + direct agent tools → candidate set.
4. Apply **SecurityContext** filter → final set exposed to Context Builder ([11-context-builder.md](./11-context-builder.md)).
5. If a skill has `execute`, the engine only calls it on **documented hooks** (e.g. pre-run, post-observation) if the product specifies; by default **not** in MVP.

---

## 5. Imperative skill with `execute`

```typescript
type SkillExecute = (args: {
  input: unknown;
  context: {
    agentId: string;
    runId: string;
    memory: MemoryAdapter;
    invokeTool: (name: string, input: unknown) => Promise<unknown>;
  };
}) => Promise<unknown>;
```

- Useful for deterministic logic without LLM or for orchestrating several tools in a fixed sequence.
- Must be **allowlisted** and audited; same risk profile as a powerful tool.

---

## 6. Quick comparison

| Aspect | Tool | Skill |
|--------|------|-------|
| Typical invocation | LLM → `action` | Engine / context |
| Side effect | Yes (via adapter) | Only if calling tools or explicit code |
| In model prompt | Schema + name | Optional (description / system) |
| Registry | ToolRunner | Skills module + store |

---

## 7. Suggested MVP

- **Declarative + template** skills only; no `execute` until tools and memory are stable.
- One example skill that constrains system text to a domain (e.g. support or internal ops) and enables a subset of tools.
