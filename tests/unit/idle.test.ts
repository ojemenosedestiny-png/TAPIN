import { describe, expect, it } from "vitest";
import { IDLE_TIMEOUT_MS, isIdleExpired } from "@/lib/auth/idle";

const now = 1_800_000_000_000;

describe("idle session timeout", () => {
  it("does not expire on the first request after login (no cookie yet)", () => {
    expect(isIdleExpired(undefined, now)).toBe(false);
  });
  it("keeps recent sessions", () => {
    expect(isIdleExpired(String(now - 5 * 60_000), now)).toBe(false);
    expect(isIdleExpired(String(now - IDLE_TIMEOUT_MS), now)).toBe(false);
  });
  it("expires after 30 minutes of inactivity", () => {
    expect(isIdleExpired(String(now - IDLE_TIMEOUT_MS - 1), now)).toBe(true);
  });
  it("treats garbage or future timestamps as expired", () => {
    expect(isIdleExpired("abc", now)).toBe(true);
    expect(isIdleExpired("", now)).toBe(true);
    expect(isIdleExpired(String(now + 10 * 60_000), now)).toBe(true);
  });
});
