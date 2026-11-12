import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metaReady, metaTemplateFor, sendMetaTemplate, sendMetaText, validMetaSignature } from "@/lib/meta-whatsapp";

const ok = (id = "wamid.X") => vi.fn(async () => new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 })) as unknown as typeof fetch;

describe("Meta WhatsApp", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is ready only with a token and a phone number ID", () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    expect(metaReady()).toBe(false);
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "EAAtest");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
    expect(metaReady()).toBe(true);
  });

  it("reads template names, with an optional placeholder count", () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_ARRIVAL", "tapin_arrival:3");
    vi.stubEnv("WHATSAPP_TEMPLATE_LATE", "tapin_late");
    vi.stubEnv("WHATSAPP_TEMPLATE_ABSENCE", "Bad Name!");
    expect(metaTemplateFor("arrival")).toEqual({ name: "tapin_arrival", params: 3 });
    expect(metaTemplateFor("late")).toEqual({ name: "tapin_late", params: undefined });
    expect(metaTemplateFor("absence")).toBeNull();
    expect(metaTemplateFor("pickup")).toBeNull();
  });

  it("sends text and templates in Meta's format", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "EAAtest");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
    const f = ok();
    expect(await sendMetaText("+2348031234567", "Hello", f)).toEqual({ ok: true, messageId: "wamid.X" });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v23.0/123/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer EAAtest");
    expect(JSON.parse(init.body as string)).toMatchObject({ messaging_product: "whatsapp", to: "2348031234567", type: "text", text: { body: "Hello" } });

    const g = ok();
    await sendMetaTemplate("+2348031234567", { name: "tapin_arrival", params: 3 }, { "1": "Ada", "2": "Bright Stars", "3": "7:42 AM", "4": "extra" }, g);
    const body = JSON.parse((g as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body as string);
    expect(body.template).toEqual({ name: "tapin_arrival", language: { code: "en" }, components: [{ type: "body", parameters: [
      { type: "text", text: "Ada" }, { type: "text", text: "Bright Stars" }, { type: "text", text: "7:42 AM" },
    ] }] });
  });

  it("reports Meta's error and whether to retry", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "EAAtest");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid parameter", code: 100 } }), { status: 400 })) as unknown as typeof fetch;
    expect(await sendMetaText("+2348031234567", "x", bad)).toEqual({ ok: false, error: "Meta 400: Invalid parameter", retryable: false });
  });

  it("checks the webhook signature", () => {
    const body = '{"entry":[]}';
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    expect(validMetaSignature(body, sig, "s3cret")).toBe(true);
    expect(validMetaSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(validMetaSignature(body, sig, undefined)).toBe(false);
    expect(validMetaSignature(body, null, "s3cret")).toBe(false);
  });
});
