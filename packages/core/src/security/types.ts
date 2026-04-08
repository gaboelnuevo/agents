export interface SessionOptions {
  id: string;
  projectId: string;
  endUserId?: string;
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
