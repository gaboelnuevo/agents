import type { SessionOptions } from "../security/types.js";

export class Session {
  readonly id: string;
  readonly projectId: string;
  readonly endUserId?: string;
  readonly expiresAtMs?: number;
  readonly fileReadRoot?: string;
  readonly allowFileReadOutsideRoot?: boolean;
  readonly allowHttpFileSources?: boolean;
  readonly httpFileSourceHostsAllowlist?: string[];

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.projectId = opts.projectId;
    this.endUserId = opts.endUserId;
    this.expiresAtMs = opts.expiresAtMs;
    this.fileReadRoot = opts.fileReadRoot;
    this.allowFileReadOutsideRoot = opts.allowFileReadOutsideRoot;
    this.allowHttpFileSources = opts.allowHttpFileSources;
    this.httpFileSourceHostsAllowlist = opts.httpFileSourceHostsAllowlist;
  }

  /** True when `expiresAtMs` is set and `atMs` is strictly after it. */
  isExpired(atMs: number = Date.now()): boolean {
    return this.expiresAtMs != null && atMs > this.expiresAtMs;
  }
}
