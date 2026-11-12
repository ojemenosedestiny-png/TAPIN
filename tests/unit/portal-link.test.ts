import { describe, expect, it, vi } from "vitest";
import { buildPortalPayload, interpretPortalResponse, keyTail, normalisePortalUrl, pingPortal, pingUrl, postPortalTap } from "@/lib/portal-link";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("school portal link", () => {
  it("accepts only https addresses, and fills in the tap path for a bare site", () => {
    expect(normalisePortalUrl("https://newworldemeraldprivateschool.com/api/kiosk/tap")).toBe("https://newworldemeraldprivateschool.com/api/kiosk/tap");
    expect(normalisePortalUrl("newworldemeraldprivateschool.com")).toBe("https://newworldemeraldprivateschool.com/api/kiosk/tap");
    expect(normalisePortalUrl("  https://school.ng/  ")).toBe("https://school.ng/api/kiosk/tap");
    expect(normalisePortalUrl("http://school.ng/api/kiosk/tap")).toBeNull();
    expect(normalisePortalUrl("https://user:pw@school.ng/x")).toBeNull();
    expect(normalisePortalUrl("https://localhost/x")).toBeNull();
    expect(normalisePortalUrl("")).toBeNull();
    expect(pingUrl("https://school.ng/api/kiosk/tap")).toBe("https://school.ng/api/kiosk/ping");
    expect(keyTail("nwek_abcdef123")).toBe("f123");
  });

  it("sends the card number or the admission number, with TapIn's tap id and the real tap time", () => {
    const at = new Date("2026-11-12T06:42:10Z");
    expect(buildPortalPayload({ matchBy: "card", cardUid: "04A1B2C3", admissionNo: "NWE/2026/00011", tapEventId: 8812, tappedAt: at }))
      .toEqual({ cardId: "04A1B2C3", tapId: "tapin-8812", tappedAt: "2026-11-12T06:42:10.000Z" });
    expect(buildPortalPayload({ matchBy: "admission", cardUid: "04A1B2C3", admissionNo: " NWE/2026/00011 ", tapEventId: 1, tappedAt: at }))
      .toEqual({ studentId: "NWE/2026/00011", tapId: "tapin-1", tappedAt: "2026-11-12T06:42:10.000Z" });
    expect(buildPortalPayload({ matchBy: "admission", cardUid: "04A1B2C3", admissionNo: null, tapEventId: 1, tappedAt: at })).toBeNull();
  });

  it("reads the portal's answers", () => {
    expect(interpretPortalResponse(200, { ok: true, result: "present", message: "Welcome, Ada. Marked present at 07:42." }))
      .toEqual({ kind: "sent", result: "present", message: "Welcome, Ada. Marked present at 07:42." });
    expect(interpretPortalResponse(200, { ok: true, result: "already", repeat: true })).toMatchObject({ kind: "sent", result: "already" });
    expect(interpretPortalResponse(200, { ok: false, result: "unknown_card", message: "Card not linked" })).toMatchObject({ kind: "rejected", result: "unknown_card" });
    expect(interpretPortalResponse(400, { ok: false, result: "refused", message: "Too old" })).toMatchObject({ kind: "rejected", result: "refused" });
    expect(interpretPortalResponse(401, { error: "Bad key" }).kind).toBe("failed");
    expect(interpretPortalResponse(403, { error: "Kiosk turned off" }).kind).toBe("failed");
    expect(interpretPortalResponse(404, null).kind).toBe("failed");
    expect(interpretPortalResponse(429, { error: "Slow down" }).kind).toBe("retry");
    expect(interpretPortalResponse(503, null).kind).toBe("retry");
  });

  it("posts in the portal's format with the key as a bearer token", async () => {
    const f = reply(200, { ok: true, result: "late", message: "Welcome, Ada. Marked late at 08:12." });
    const o = await postPortalTap("https://school.ng/api/kiosk/tap", "nwek_secret", { cardId: "04A1B2C3", tapId: "tapin-5", tappedAt: "2026-11-12T07:12:00.000Z" }, f);
    expect(o).toEqual({ kind: "sent", result: "late", message: "Welcome, Ada. Marked late at 08:12." });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://school.ng/api/kiosk/tap");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer nwek_secret");
    expect(JSON.parse(init.body as string)).toEqual({ cardId: "04A1B2C3", tapId: "tapin-5", tappedAt: "2026-11-12T07:12:00.000Z" });
  });

  it("retries when the portal can't be reached", async () => {
    const down = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect((await postPortalTap("https://school.ng/api/kiosk/tap", "k", { cardId: "1", tapId: "t", tappedAt: "x" }, down)).kind).toBe("retry");
  });

  it("checks the connection with the ping address", async () => {
    expect(await pingPortal("https://school.ng/api/kiosk/tap", "k", reply(200, { ok: true, kiosk: "Main gate" }))).toEqual({ ok: true, kiosk: "Main gate" });
    const bad = await pingPortal("https://school.ng/api/kiosk/tap", "k", reply(401, { error: "Wrong key" }));
    expect(bad.ok).toBe(false);
  });
});
