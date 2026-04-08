export interface SessionOptions {
  id: string;
  projectId: string;
  endUserId?: string;
  /** When set, runs and resumes are rejected after this instant (Unix ms, same as `Date.now()`). */
  expiresAtMs?: number;
}

export interface SecurityContext {
  principalId: string;
  kind: "user" | "service" | "end_user" | "internal";
  organizationId: string;
  projectId: string;
  endUserId?: string;
  roles: string[];
  scopes: string[];
}
