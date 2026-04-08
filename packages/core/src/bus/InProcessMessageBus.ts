import type { AgentMessage, MessageBus } from "./MessageBus.js";

/**
 * In-process message bus suitable for single-process multi-agent setups.
 * Messages are dispatched via EventEmitter-style callbacks — no
 * cross-process delivery. For cluster deployments use a Redis-backed
 * implementation. See docs/core/19-cluster-deployment.md §5.
 */
export class InProcessMessageBus implements MessageBus {
  private listeners = new Map<string, ((msg: AgentMessage) => void)[]>();
  private counter = 0;

  async send(partial: Omit<AgentMessage, "id">): Promise<void> {
    const msg: AgentMessage = {
      ...partial,
      id: `msg_${++this.counter}_${Date.now()}`,
    };
    const fns = this.listeners.get(msg.toAgentId) ?? [];
    for (const fn of fns) fn(msg);
  }

  async waitFor(
    agentId: string,
    filter: { correlationId?: string; fromAgentId?: string },
    options?: { timeoutMs?: number },
  ): Promise<AgentMessage> {
    const timeout = options?.timeoutMs ?? 30_000;
    return new Promise<AgentMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`MessageBus.waitFor timed out after ${timeout}ms`));
      }, timeout);

      const handler = (msg: AgentMessage) => {
        if (filter.correlationId && msg.correlationId !== filter.correlationId)
          return;
        if (filter.fromAgentId && msg.fromAgentId !== filter.fromAgentId)
          return;
        cleanup();
        resolve(msg);
      };

      const cleanup = () => {
        clearTimeout(timer);
        const arr = this.listeners.get(agentId);
        if (arr) {
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };

      const arr = this.listeners.get(agentId) ?? [];
      arr.push(handler);
      this.listeners.set(agentId, arr);
    });
  }
}
