import type { SessionOptions } from "../security/types.js";

export class Session {
  readonly id: string;
  readonly projectId: string;
  readonly endUserId?: string;
  readonly expiresAtMs?: number;

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.projectId = opts.projectId;
    this.endUserId = opts.endUserId;
    this.expiresAtMs = opts.expiresAtMs;
  }

  /** True when `expiresAtMs` is set and `atMs` is strictly after it. */
  isExpired(atMs: number = Date.now()): boolean {
    return this.expiresAtMs != null && atMs > this.expiresAtMs;
  }
}
