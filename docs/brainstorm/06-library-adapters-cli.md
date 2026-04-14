# Node.js library, adapters, and CLI

## npm package goal

- Define agents with memory and skills.
- Run with loop, wait/resume, and tools.
- Multiple LLM providers via adapter.
- Promise-like interface with hooks.
- Use from Node without requiring a server (REST optional later).

## Suggested folder structure

```
agent-lib/
├── src/
│   ├── Agent.js
│   ├── AgentExecution.js
│   ├── Memory.js
│   ├── ToolRunner.js
│   ├── Skills.js
│   ├── LLMAdapter.js
│   └── index.js
├── cli/
│   ├── index.js
│   └── commands/
│       ├── run.js
│       ├── resume.js
│       ├── list.js
│       ├── logs.js
│       ├── memory.js
│       └── send.js      # when multi-agent exists
├── package.json
└── test/
```

## Create agent (conceptual example)

```javascript
const agent = new Agent({
  id: "ops-analyst",
  systemPrompt: "Triage operational intake and tickets",
  skills: ["intakeSummary"],
  tools: ["saveMemory", "getMemory"],
  memoryConfig: {
    shortTerm: 5,
    longTerm: true,
    working: {}
  },
  llmProvider: { type: "openai", model: "gpt-4" }
});
```

## Resume

```javascript
agent.resume(runId, "user_input_answer").then(...);
```

## Memory Adapter

Abstracts **where** memory is saved and queried without changing the loop.

### Minimal interface

```typescript
interface MemoryAdapter {
  save(agentId: string, memoryType: string, content: unknown): Promise<void>;
  query(agentId: string, memoryType: string, filter?: unknown): Promise<unknown[]>;
  delete(agentId: string, memoryType: string, filter?: unknown): Promise<void>;
  getState(agentId: string): Promise<unknown>;
}
```

### Memory types

| Type | Description | Example backend |
|------|-------------|-----------------|
| `shortTerm` | Recent, volatile | RAM |
| `working` | Execution variables | RAM |
| `longTerm` | Persistent | MongoDB, SQLite, file |
| `vectorMemory` | Embeddings / RAG | Pinecone, Weaviate, etc. |

### Integration

`agentExecution.setMemoryAdapter(adapter)` — memory tools delegate to the adapter.

## Tool Adapter

The agent emits `action`; the **Tool Adapter** executes and returns the **observation**.

### Minimal interface

```typescript
interface ToolAdapter {
  name: string;
  execute(input: unknown, context: unknown): Promise<unknown>;
  validate?(input: unknown): boolean;
}
```

### Examples

- `system_save_memory`: delegates to `MemoryAdapter`.
- `http_request`: fetch external APIs.

### Flow

```
action → find adapter by name → validate? → execute → observation → history
```

**Hooks** observe; **adapters** execute.

## MCP-style CLI

Base commands:

```bash
agent-cli list
agent-cli run <agentId> --input "..."
agent-cli resume <runId> --input "..."
agent-cli memory <agentId> [--type shortTerm]
agent-cli logs <runId>
```

The CLI uses the same library, prints thoughts/actions to the terminal, and can persist local state (e.g. `.agent/` folder in JSON or SQLite).

## Library + CLI MVP

- Agent + `AgentExecution` + loop.
- Adapters: InMemory + one persistent (e.g. Mongo).
- Tools: `system_save_memory`, `http_request` (as needed).
- Promise-style hooks.
- CLI: run, resume, memory, logs.

## Success criteria

- Same semantics in code and CLI.
- Memory and tools swappable via adapters.
- Inspection via hooks and logs.
