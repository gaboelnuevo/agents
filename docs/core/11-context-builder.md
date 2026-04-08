# Context Builder

Component that **assembles** LLM input on each loop iteration: block order, truncation, security filtering, and exposing tools/skills to the model.

Related: [02-architecture.md](./02-architecture.md); [07-definition-syntax.md](./07-definition-syntax.md) (**Step** / JSON rule); [08-scope-and-security.md](./08-scope-and-security.md) (**SecurityContext** filtering); [10-llm-adapter.md](./10-llm-adapter.md); [12-skills.md](./12-skills.md); [15-multi-tenancy.md](./15-multi-tenancy.md) (memory scope).

---

## 1. Inputs

| Source | Use |
|--------|-----|
| **AgentDefinition** | `systemPrompt`, `tools` / `skills` lists, `memoryConfig`, `llm`. |
| **Run** | Initial `input`, `history` (protocol messages that already occurred). |
| **Session** | `sessionId`, `projectId`, optional `endUserId` — determines memory scope. |
| **MemoryAdapter** | `shortTerm`, `longTerm`, `working`, `vectorMemory` snapshots per policy. |
| **SecurityContext** | Filter tools/skills allowed for this principal + project. |
| **ToolRegistry** | Schemas and descriptions exposed to the model (post-filter). |

---

## 2. Recommended context order

Logical order (everything may go in one `system` or split across messages per adapter):

1. Agent **base system** (`systemPrompt`), including the output rule: one JSON `Step` per turn ([07-definition-syntax.md](./07-definition-syntax.md)).
2. **Working memory** (compact): volatile run/session state. Scoped by `sessionId`.
3. **Long-term** (retrieved chunks): RAG or persisted facts; **bounded** in size. Scoped by `endUserId` when present, otherwise by `sessionId` (see §2.1).
4. **Short-term**: last user/assistant turns for the **same run** or session (avoid duplicating protocol `history` if injected separately). Scoped by `sessionId`.
5. **Visible tool catalog**: names, descriptions, `inputSchema` (only those passing SecurityLayer + agent allowlist).
6. **Skills** (optional): if the design has "modes" or per-skill instructions, short text or active ids ([12-skills.md](./12-skills.md)).
7. **Protocol history** in a model-readable form (thought/action/observation/wait/summary) **or** mapped to `user`/`assistant` messages under a fixed convention.

The rule is **one convention** per product, documented, so the `Step` parser and future fine-tuning stay predictable.

### 2.1 Memory scope resolution

When the session includes `endUserId` (B2B2C / end-user facing agents):

- `shortTerm` and `working` → keyed by `sessionId` (per conversation).
- `longTerm` and `vectorMemory` → keyed by `endUserId` (persists across conversations).

When no `endUserId` is present (internal / operator use):

- All memory types → keyed by `sessionId`.

This allows an end-user facing agent to recall facts about a returning customer while keeping each conversation's turns isolated. See [15-multi-tenancy.md §4.3](./15-multi-tenancy.md) and [05-adapters.md](./05-adapters.md) for key patterns.

---

## 3. Security filtering

Before serializing tools into the prompt:

1. Intersection: `agent.tools` ∩ tools in registry ∩ tools allowed by **scopes** in `SecurityContext`.
2. Deny sensitive tools (`http_request`, `send_message`, etc.) by default if the principal lacks scope.
3. Do not include **other projects' data** in memory blocks even if the adapter returned the wrong key: validate `projectId` in the read layer.
4. Do not include **other end-users' data** in memory blocks: validate `endUserId` matches when loading `longTerm` / `vectorMemory`.

---

## 4. Truncation and token budget

- **Global budget** per LLM call: split across system, memory, and history.
- **Strategies**: truncate long-term by relevance; keep N latest short-term messages; summarize old protocol history into one "summary through step K" block (optional, v2).
- If context still overflows after truncation: fail the build with a clear error or drop blocks in reverse list order (drop least relevant long-term first).

---

## 5. Tool serialization for the model

- Format aligned with what **LLM Adapter** expects ([10](./10-llm-adapter.md)): JSON Schema or vendor equivalent.
- Include only necessary properties; avoid secrets in `description`.

---

## 6. Context Builder output

Object consumed by the engine → `LLMAdapter.generate(...)`:

```typescript
interface BuiltContext {
  messages: LLMRequest["messages"];
  tools?: LLMRequest["tools"];
  toolChoice?: LLMRequest["toolChoice"];
  responseFormat?: LLMRequest["responseFormat"];
}
```

The engine adds `model`, `provider`, `signal`, token limits from `AgentDefinition` / run options.

---

## 7. Determinism and tests

- The builder should be a **pure function** of its inputs (same input → same prompt), except optional clock in meta.
- Unit tests: agent + run + mock memory + security fixtures → snapshot of string or `messages` array.
