import type { SessionOptions } from "../security/types.js";

export class Session {
  readonly id: string;
  readonly projectId: string;
  readonly endUserId?: string;
  /** Host-owned bag; see {@link SessionOptions.sessionContext}. */
  readonly sessionContext?: Readonly<Record<string, unknown>>;
  readonly expiresAtMs?: number;
  readonly fileReadRoot?: string;
  readonly allowFileReadOutsideRoot?: boolean;
  readonly allowHttpFileSources?: boolean;
  readonly httpFileSourceHostsAllowlist?: string[];

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.projectId = opts.projectId;
    this.endUserId = opts.endUserId;
    this.sessionContext = opts.sessionContext;
    this.expiresAtMs = opts.expiresAtMs;
    this.fileReadRoot = opts.fileReadRoot;
    this.allowFileReadOutsideRoot = opts.allowFileReadOutsideRoot;
    this.allowHttpFileSources = opts.allowHttpFileSources;
    this.httpFileSourceHostsAllowlist = opts.httpFileSourceHostsAllowlist;
  }

  private toOptions(): SessionOptions {
    return {
      id: this.id,
      projectId: this.projectId,
      ...(this.endUserId !== undefined ? { endUserId: this.endUserId } : {}),
      ...(this.sessionContext !== undefined ? { sessionContext: this.sessionContext } : {}),
      ...(this.expiresAtMs !== undefined ? { expiresAtMs: this.expiresAtMs } : {}),
      ...(this.fileReadRoot !== undefined ? { fileReadRoot: this.fileReadRoot } : {}),
      ...(this.allowFileReadOutsideRoot !== undefined
        ? { allowFileReadOutsideRoot: this.allowFileReadOutsideRoot }
        : {}),
      ...(this.allowHttpFileSources !== undefined
        ? { allowHttpFileSources: this.allowHttpFileSources }
        : {}),
      ...(this.httpFileSourceHostsAllowlist !== undefined
        ? { httpFileSourceHostsAllowlist: this.httpFileSourceHostsAllowlist }
        : {}),
    };
  }

  /** Returns a copy with the provided absolute expiry (or no expiry when omitted). */
  withExpiresAt(expiresAtMs?: number): Session {
    return new Session({
      ...this.toOptions(),
      ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
    });
  }

  /**
   * Extends the session deadline by `ttlMs`.
   * When the session already expires in the future, extension is added on top of that deadline.
   * When it is unset or already past, extension starts from `atMs` (default `Date.now()`).
   */
  extendBy(ttlMs: number, atMs: number = Date.now()): Session {
    const base = this.expiresAtMs != null && this.expiresAtMs > atMs ? this.expiresAtMs : atMs;
    return this.withExpiresAt(base + ttlMs);
  }

  /** True when `expiresAtMs` is set and `atMs` is strictly after it. */
  isExpired(atMs: number = Date.now()): boolean {
    return this.expiresAtMs != null && atMs > this.expiresAtMs;
  }
}
