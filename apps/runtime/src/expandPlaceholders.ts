/**
 * Expand `${VAR}` and `${VAR:-default}` using the current process environment.
 * Expanded values may contain secrets; do not log merged config in production (see README § Security).
 */
export function expandEnvPlaceholders(input: string): string {
  return input.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (_m, name: string, def?: string) => {
    const v = process.env[name];
    if (v !== undefined && v !== "") return v;
    return def ?? "";
  });
}

export function expandDeep<T>(value: T): T {
  if (typeof value === "string") return expandEnvPlaceholders(value) as T;
  if (Array.isArray(value)) return value.map((x) => expandDeep(x)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandDeep(v);
    }
    return out as T;
  }
  return value;
}
