import type { MemoryScope } from "@agent-runtime/core";

/** Same prefix layout as `@agent-runtime/adapters-upstash` (`UpstashRedisMemoryAdapter`). */
export function memoryKeyPrefix(scope: MemoryScope): string {
  const eu = scope.endUserId ? `eu:${scope.endUserId}` : "sess";
  return `m:${scope.projectId}:${scope.agentId}:${scope.sessionId}:${eu}`;
}
