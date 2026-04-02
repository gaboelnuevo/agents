# Agent runtime: purpose and technical stack

## System goal (vision)

An **API / runtime** where the agent:

1. **Is not stateless by default**: real memory and evolution across executions.
2. Has **skills**: reusable capabilities, not loose prompts only.
3. Has **its own tools** for memory and actions: the model chooses what to invoke under engine control.

Together: **Agent Runtime + cognitive layer**.

## Conceptual endpoint

```http
POST /agent/run
```

```json
{
  "agentId": "agent-1",
  "input": "operational context..."
}
```

## Agent definition (concept)

```json
{
  "id": "agent-1",
  "systemPrompt": "...",
  "skills": ["parse_intake", "check_sla"],
  "memory": { "type": "vector + short_term" },
  "tools": ["memory_search", "save_memory"]
}
```

## Memory in three layers

| Layer | Role |
|-------|------|
| **Short-term** | Recent context (chat-like history). |
| **Long-term** | Persistent in DB, optionally vectorized (embeddings). |
| **Working memory** | Current agent state (e.g. `priority`, `session`, flags). |

## Skills

Named modules with description and handler; they can use LLM, pure logic, or both.

## Example tools

- `memory_search`: search memory (e.g. vector).
- `save_memory`: persist insights.
- `update_state`: update working memory.

## Agent loop (high level)

```
Input → Reason → Decide → Act → Update memory → (repeat or finish)
```

The original document stresses **semi-agents** at first: few decisions per request, more control, fewer erratic behaviors.

## OpenAI / Anthropic as the engine

Yes: **any LLM provider** can be the engine. The question is whether the project is only a wrapper.

### Option 1: API wrappers

- Pros: simple, swappable provider, unified interface.
- Cons: commodity; does not define real agents by itself.

### Option 2: MCP (Model Context Protocol)

- Pros: standard for external tools, interoperable.
- Cons: connection infrastructure; does not replace memory, identity, or agent policy.

### Recommended option 3: Agent Runtime

- **Layer 1 – LLM Adapter**: `generate({ provider, model, prompt, tools })`.
- **Layer 2 – Agent Engine**: memory, skills, tools, loop (the differentiating value).
- **Layer 3 – Tools**: internal and, if needed, MCP-compatible later.

**Analogy**: OpenAI ≈ engine; MCP ≈ plugs; your system ≈ brain / mini OS.

### Suggested implementation order

1. Engine with `POST /agent/run`.
2. Implement one provider first (e.g. OpenAI), then expand.
3. Define memory, tools, and skills.
4. MCP optional **after**, not as the starting point.

## Formal purpose (summary)

> API to run agents with **persistent state**, structured memory, and configurable skills, **decoupled from the AI provider**.

### Short purpose

“Give agents memory, skills, and control.”

### What it is not (mental v1)

- Generic chat wrapper.
- Conversational chatbot as the only product.
- Mandatory visual builder at the start.
- Pure Zapier without agent identity.

### What it is

- Mini operating system for agents: state, decision, action, memory.

### Feature test

Ask: “Does this make the agent more autonomous, more aware, or more capable?” If not, defer or drop.
