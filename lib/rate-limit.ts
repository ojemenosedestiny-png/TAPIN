/**
 * Fixed-window rate limiter kept in memory.
 * On Vercel each server instance has its own memory, so this slows down abuse but is not a hard
 * global limit. Swap the store for a shared one (e.g. a Postgres table) if that ever matters.
 */
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterMs: number };

export function checkRateLimit(
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
  now: number = Date.now(),
): RateLimitResult {
  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    if (store.size > 10_000) prune(now);
    return { ok: true, remaining: max - 1 };
  }
  if (bucket.count >= max) return { ok: false, retryAfterMs: bucket.resetAt - now };
  bucket.count += 1;
  return { ok: true, remaining: max - bucket.count };
}

function prune(now: number) {
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
}

/** Test helper. */
export function resetRateLimits() {
  store.clear();
}
