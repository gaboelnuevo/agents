# Requirement — Session-Scoped `RunStore` Queries for Scalable Chat History Recall

**Audience:** OpenCoreAgents maintainers  
**Status:** Proposal / product requirement  
**Scope:** `@opencoreagents/core`, `@opencoreagents/adapters-redis`

---

## 1. Problem

The current `RunStore` contract only exposes:

```ts
interface RunStore {
  save(run: Run): Promise<void>;
  saveIfStatus(run: Run, expectedStatus: RunStatus): Promise<boolean>;
  load(runId: string): Promise<Run | null>;
  delete(runId: string): Promise<void>;
  listByAgent(agentId: string, status?: RunStatus): Promise<Run[]>;
}
```

In multi-tenant or high-volume production environments, this forces applications to fetch all runs for an agent and then filter by `sessionId` in memory.

That approach creates avoidable:

- latency
- memory pressure
- Redis and network overhead
- implementation duplication across apps

This becomes especially painful for features such as `recall_chat_history`, where the common access path is "recent runs for one session", not "all runs for one agent".

---

## 2. Requested Capability

Add session-scoped query support to `RunStore` so applications can retrieve session history efficiently without scanning the full run set for an agent.

---

## 3. Proposed API

Minimum addition:

```ts
interface RunStore {
  // existing methods...
  listByAgentAndSession(
    agentId: string,
    sessionId: string,
    opts?: {
      status?: RunStatus;
      limit?: number;
      cursor?: string;
      order?: "asc" | "desc";
    }
  ): Promise<{ runs: Run[]; nextCursor?: string }>;
}
```

Recommended defaults:

- `order`: `"desc"` (most recent first)
- `limit`: a conservative default suitable for history recall paths

Optional nice-to-have:

```ts
interface SessionQueryableRunStore extends RunStore {
  listBySession(
    projectId: string,
    sessionId: string,
    opts?: {
      status?: RunStatus;
      limit?: number;
      cursor?: string;
      order?: "asc" | "desc";
    }
  ): Promise<{ runs: Run[]; nextCursor?: string }>;
}
```

If the broader `listBySession(...)` shape is too opinionated for the base contract, `listByAgentAndSession(...)` alone would already unlock the main production use case.

Current implemented shape:

```ts
interface RunStore {
  // existing methods...
  listByAgentAndSession(
    agentId: string,
    sessionId: string,
    opts?: {
      status?: RunStatus;
      limit?: number;
      cursor?: string;
      order?: "asc" | "desc";
    }
  ): Promise<{ runs: Run[]; nextCursor?: string }>;
}
```

---

## 4. Adapter Expectations

For `@opencoreagents/adapters-redis`:

- Maintain a secondary index keyed by `agentId + sessionId`.
- Keep index mutations atomic with `save(...)` and `saveIfStatus(...)`.
- Support efficient pagination.
- Support recency ordering without loading every run in the agent set.
- Preserve existing `listByAgent(...)` behavior for backward compatibility.

Implementation-wise, the key point is that query cost should scale with runs in the target session, not with total runs for the agent.

---

## 5. Performance Acceptance Criteria

- P95 query time for session-history retrieval stays stable as total runs per agent grow.
- Query cost scales with runs in the requested session, not total runs for the agent.
- Common session-history paths do not require a full scan of all run IDs for an agent.
- Pagination remains efficient for long-lived sessions.

---

## 6. Backward Compatibility

This should be a non-breaking addition.

Acceptable options:

- add `listByAgentAndSession(...)` directly to `RunStore` and update implementations
- introduce an optional capability interface and feature-detect in consumers

If maintainers want zero friction for existing custom stores, the capability-interface route is a reasonable fallback.

---

## 7. Why This Matters

This unlocks production-safe implementations of:

- `recall_chat_history`
- session-level history inspection
- conversation summaries
- resume and routing helpers that need recent session runs

Without this capability, each application has to build custom indexing or accept inefficient full-agent scans in hot paths.

---

## 8. Suggested Maintainer Framing

If helpful, this can be framed as:

> Add session-scoped `RunStore` query support so production apps can retrieve run history by `sessionId` without scanning all runs for an agent.

That keeps the request narrow, infrastructure-friendly, and easy to evaluate independently from higher-level chat-memory features.
