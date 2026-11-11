import { describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";
import { checkRateLimitShared, hashLimitKey } from "@/lib/rate-limit-shared";
import { resetRateLimits } from "@/lib/rate-limit";
import { mustSetUpMfa } from "@/lib/auth/session";

describe("security headers", () => {
  const prod = Object.fromEntries(securityHeaders({ supabaseUrl: "https://abc.supabase.co" }).map((h) => [h.key, h.value]));
  const csp = prod["Content-Security-Policy"]!;

  it("can't be framed by another site, and loads nothing from unknown places", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(prod["X-Frame-Options"]).toBe("DENY");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
  it("only talks to its own Supabase project", () => {
    expect(csp).toMatch(/connect-src 'self' https:\/\/abc\.supabase\.co wss:\/\/abc\.supabase\.co/);
    expect(csp).toMatch(/img-src [^;]*https:\/\/abc\.supabase\.co/);
  });
  it("forms post only to TapIn, or to Flutterwave's checkout for payments", () => {
    expect(csp).toContain("form-action 'self' https://checkout.flutterwave.com");
  });
  it("no eval on the live site (only in local development), and HTTPS everywhere", () => {
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ dev: true })).toContain("unsafe-eval");
    expect(prod["Strict-Transport-Security"]).toMatch(/max-age=\d{8}/);
  });
  it("switches off browser features TapIn doesn't use", () => {
    expect(prod["Permissions-Policy"]).toContain("microphone=()");
    expect(prod["Permissions-Policy"]).toContain("geolocation=()");
    expect(prod["Permissions-Policy"]).toContain("camera=(self)"); // student photos
    expect(prod["X-Content-Type-Options"]).toBe("nosniff");
  });
});

describe("shared attempt limits", () => {
  it("stores only a hash of the key, never the email or phone", () => {
    const h = hashLimitKey("login:1.2.3.4:mum@example.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("example");
  });
  it("refuses once the shared counter says so, even if this server hasn't seen the attempts", async () => {
    resetRateLimits();
    const rpc = vi.fn(async () => false);
    expect((await checkRateLimitShared("login:1.2.3.4:a@b.ng", { max: 5, windowMs: 60_000 }, rpc)).ok).toBe(false);
    expect(rpc).toHaveBeenCalledWith(hashLimitKey("login:1.2.3.4:a@b.ng"), 5, 60);
  });
  it("this server's own limit refuses first, without asking the database", async () => {
    resetRateLimits();
    const rpc = vi.fn(async () => true);
    for (let i = 0; i < 3; i++) await checkRateLimitShared("forgot:9.9.9.9", { max: 3, windowMs: 60_000 }, rpc);
    expect((await checkRateLimitShared("forgot:9.9.9.9", { max: 3, windowMs: 60_000 }, rpc)).ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it("if the database can't be reached, this server's limit still applies", async () => {
    resetRateLimits();
    expect((await checkRateLimitShared("demo:5.5.5.5", { max: 1, windowMs: 60_000 }, async () => null)).ok).toBe(true);
    expect((await checkRateLimitShared("demo:5.5.5.5", { max: 1, windowMs: 60_000 }, async () => null)).ok).toBe(false);
  });
  it("requests with no known address don't share one bucket (that would lock everyone out)", async () => {
    resetRateLimits();
    const rpc = vi.fn(async () => false);
    expect((await checkRateLimitShared("demo:unknown", { max: 5, windowMs: 60_000 }, rpc)).ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("two-factor for the super admin", () => {
  it("the super admin must turn it on; school staff choose for themselves", () => {
    expect(mustSetUpMfa("super_admin", "aal1", {})).toBe(true);
    expect(mustSetUpMfa("super_admin", "aal2", {})).toBe(false);
    expect(mustSetUpMfa("school_admin", "aal1", {})).toBe(false);
  });
  it("the test-only switch can never work on the live site", () => {
    expect(mustSetUpMfa("super_admin", "aal1", { TAPIN_ALLOW_SUPER_ADMIN_WITHOUT_2FA: "1" })).toBe(false);
    expect(mustSetUpMfa("super_admin", "aal1", { TAPIN_ALLOW_SUPER_ADMIN_WITHOUT_2FA: "1", VERCEL: "1" })).toBe(true);
  });
});
