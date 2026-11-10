/** Sessions end after this much inactivity. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const LAST_ACTIVE_COOKIE = "tapin_last_active";

/** True when the last-activity timestamp is missing-but-required, unparsable, or too old. */
export function isIdleExpired(lastActive: string | undefined, now: number, timeoutMs = IDLE_TIMEOUT_MS): boolean {
  if (lastActive === undefined) return false; // first request after login: nothing to compare yet
  const ts = Number(lastActive);
  if (!Number.isFinite(ts) || ts <= 0) return true;
  if (ts > now + 60_000) return true; // clock tampering / garbage from the future
  return now - ts > timeoutMs;
}

/** Cookie options for the last-activity stamp (shared by the proxy, login and logout). */
export const LAST_ACTIVE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  // Must outlive the idle timeout, otherwise an expired cookie looks like a fresh login.
  maxAge: Math.ceil((IDLE_TIMEOUT_MS * 48) / 1000),
};
