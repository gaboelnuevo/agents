/**
 * Avoid leaking Redis credentials (userinfo) into stdout/stderr. Does not affect connection strings.
 */
export function redactRedisUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    if (u.username) u.username = "***";
    if (u.password) u.password = "***";
    return u.href;
  } catch {
    return "<invalid-redis-url>";
  }
}
