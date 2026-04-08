import type { SessionOptions } from "../security/types.js";

export class Session {
  readonly id: string;
  readonly projectId: string;
  readonly endUserId?: string;

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.projectId = opts.projectId;
    this.endUserId = opts.endUserId;
  }
}
