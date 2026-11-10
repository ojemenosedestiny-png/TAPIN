import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signStandardWebhook, verifyStandardWebhook } from "@/lib/standard-webhooks";
import { chooseChannel, whatsappData } from "@/lib/alert-rules";

const SECRET = `v1,whsec_${Buffer.from("a-test-secret-for-tapin-hooks").toString("base64")}`;

describe("Supabase hook signatures (Standard Webhooks)", () => {
  const body = JSON.stringify({ user: { phone: "2348031234567" }, sms: { otp: "123456" } });
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);

  it("accepts a correctly signed request", () => {
    const signature = signStandardWebhook(SECRET, "msg_1", ts, body);
    expect(verifyStandardWebhook({ secret: SECRET, id: "msg_1", timestamp: ts, signature, body, now })).toBe(true);
  });
  it("accepts when one of several signatures matches (secret rotation)", () => {
    const signature = `v1,bm90LXRoZS1yaWdodC1vbmU= ${signStandardWebhook(SECRET, "msg_1", ts, body)}`;
    expect(verifyStandardWebhook({ secret: SECRET, id: "msg_1", timestamp: ts, signature, body, now })).toBe(true);
  });
  it("rejects tampering, wrong secrets, missing headers and old timestamps", () => {
    const signature = signStandardWebhook(SECRET, "msg_1", ts, body);
    expect(verifyStandardWebhook({ secret: SECRET, id: "msg_1", timestamp: ts, signature, body: body.replace("123456", "000000"), now })).toBe(false);
    expect(verifyStandardWebhook({ secret: `v1,whsec_${Buffer.from("other").toString("base64")}`, id: "msg_1", timestamp: ts, signature, body, now })).toBe(false);
    expect(verifyStandardWebhook({ secret: SECRET, id: null, timestamp: ts, signature, body, now })).toBe(false);
    expect(verifyStandardWebhook({ secret: SECRET, id: "msg_1", timestamp: ts, signature, body, now: now + 10 * 60_000 })).toBe(false);
  });
});

describe("the sign-in code hook", () => {
  let calls: { url: string; body: Record<string, unknown> }[] = [];
  beforeEach(() => {
    calls = [];
    vi.stubEnv("SEND_SMS_HOOK_SECRET", SECRET);
    vi.stubEnv("TERMII_API_KEY", "k");
    vi.stubEnv("TERMII_SENDER_ID", "TapIn");
    vi.stubEnv("TERMII_BASE_URL", "https://termii.test");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ code: "ok", message_id_str: "1" }), { status: 200 });
    }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const call = async (body: string, sign = true) => {
    const { POST } = await import("@/app/api/auth/sms-hook/route");
    const ts = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = { "webhook-id": "msg_9", "webhook-timestamp": ts };
    if (sign) headers["webhook-signature"] = signStandardWebhook(SECRET, "msg_9", ts, body);
    return POST(new NextRequest("http://localhost/api/auth/sms-hook", { method: "POST", body, headers }));
  };

  it("texts the code to the parent through Termii", async () => {
    const res = await call(JSON.stringify({ user: { phone: "2348031234567" }, sms: { otp: "482913" } }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://termii.test/api/sms/send");
    expect(calls[0]!.body).toMatchObject({ to: "2348031234567", from: "TapIn" });
    expect(String(calls[0]!.body.sms)).toContain("482913");
  });

  it("refuses unsigned requests and sends nothing", async () => {
    const res = await call(JSON.stringify({ user: { phone: "2348031234567" }, sms: { otp: "482913" } }), false);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("SMS or WhatsApp", () => {
  it("uses WhatsApp only when the parent chose it and a template exists", () => {
    expect(chooseChannel("whatsapp", true)).toBe("whatsapp");
    expect(chooseChannel("whatsapp", false)).toBe("sms");
    expect(chooseChannel("sms", true)).toBe("sms");
    expect(chooseChannel(null, true)).toBe("sms");
  });
  it("fills template placeholders {{1}}–{{4}} and drops empty ones", () => {
    expect(whatsappData({ "1": "Chioma Okafor", "2": "Bright Future", "3": "7:42 AM", "4": "" })).toEqual({ "1": "Chioma Okafor", "2": "Bright Future", "3": "7:42 AM" });
    expect(whatsappData({ "1": 5, x: "y" })).toEqual({});
  });
});
