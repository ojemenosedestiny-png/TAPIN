import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";

const opts = { max: 3, windowMs: 60_000 };

describe("rate limiter", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to max requests per window, then blocks", () => {
    const t = 1_000;
    expect(checkRateLimit("k", opts, t).ok).toBe(true);
    expect(checkRateLimit("k", opts, t).ok).toBe(true);
    expect(checkRateLimit("k", opts, t).ok).toBe(true);
    const blocked = checkRateLimit("k", opts, t + 10_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBe(50_000);
  });

  it("resets after the window", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("k", opts, 0);
    expect(checkRateLimit("k", opts, 60_000).ok).toBe(true);
  });

  it("keeps keys independent", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("a", opts, 0);
    expect(checkRateLimit("a", opts, 0).ok).toBe(false);
    expect(checkRateLimit("b", opts, 0).ok).toBe(true);
  });
});
