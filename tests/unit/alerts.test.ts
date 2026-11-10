import { describe, expect, it } from "vitest";
import { alertForTap, inQuietHours, quietEndsAt, renderTemplate, smsPages, unknownFields } from "@/lib/alert-rules";
import { sendSms, termiiNumber, type TermiiConfig } from "@/lib/termii";

const on = { arrival_enabled: true, departure_enabled: true, late_enabled: true, summary_mode: false };

describe("which SMS a tap creates (build plan §5 table)", () => {
  it("arrival on first tap, departure on sign-out", () => {
    expect(alertForTap("signed_in", false, on)).toBe("arrival");
    expect(alertForTap("signed_out", false, on)).toBe("departure");
  });
  it("late replaces arrival", () => {
    expect(alertForTap("signed_in", true, on)).toBe("late");
  });
  it("late switched off falls back to a normal arrival", () => {
    expect(alertForTap("signed_in", true, { ...on, late_enabled: false })).toBe("arrival");
  });
  it("respects each switch", () => {
    expect(alertForTap("signed_in", false, { ...on, arrival_enabled: false })).toBeNull();
    expect(alertForTap("signed_out", false, { ...on, departure_enabled: false })).toBeNull();
  });
  it("daily summary holds arrival and departure but late still goes out", () => {
    const s = { ...on, summary_mode: true };
    expect(alertForTap("signed_in", false, s)).toBeNull();
    expect(alertForTap("signed_out", false, s)).toBeNull();
    expect(alertForTap("signed_in", true, s)).toBe("late");
  });
});

describe("templates", () => {
  it("renders the plan's example message", () => {
    expect(renderTemplate("{greeting}. {full_name} arrived at {school} at {time}.", {
      greeting: "Good morning", full_name: "Chioma Okafor", school: "Bright Future School", time: "7:42 AM",
    })).toBe("Good morning. Chioma Okafor arrived at Bright Future School at 7:42 AM.");
  });
  it("leaves unknown fields as typed and reports them", () => {
    expect(renderTemplate("Hi {parent_name}", {})).toBe("Hi {parent_name}");
    expect(unknownFields("Hi {parent_name}, {full_name}")).toEqual(["parent_name"]);
  });
  it("counts SMS pages", () => {
    expect(smsPages("x".repeat(160))).toBe(1);
    expect(smsPages("x".repeat(161))).toBe(2);
    expect(smsPages("x".repeat(306))).toBe(2);
    expect(smsPages("x".repeat(307))).toBe(3);
  });
});

describe("quiet hours", () => {
  it("handles windows that cross midnight", () => {
    expect(inQuietHours("21:00", "20:00", "06:00")).toBe(true);
    expect(inQuietHours("05:59", "20:00", "06:00")).toBe(true);
    expect(inQuietHours("06:00", "20:00", "06:00")).toBe(false);
    expect(inQuietHours("12:00", "20:00", "06:00")).toBe(false);
  });
  it("handles same-day windows and 'off'", () => {
    expect(inQuietHours("13:00", "12:00", "14:00")).toBe(true);
    expect(inQuietHours("14:00", "12:00", "14:00")).toBe(false);
    expect(inQuietHours("13:00", "00:00", "00:00")).toBe(false);
  });
  it("works out when quiet hours end in the school's timezone", () => {
    // 21:30 in Lagos (UTC+1) → ends 06:00 Lagos = 05:00Z next day
    expect(quietEndsAt(new Date("2026-11-10T20:30:00Z"), "06:00", "Africa/Lagos").toISOString()).toBe("2026-11-11T05:00:00.000Z");
    // 05:15 Lagos → 45 minutes later
    expect(quietEndsAt(new Date("2026-11-11T04:15:00Z"), "06:00", "Africa/Lagos").toISOString()).toBe("2026-11-11T05:00:00.000Z");
  });
});

describe("Termii client", () => {
  const cfg: TermiiConfig = { apiKey: "k", senderId: "TapIn", baseUrl: "https://example.test", channel: "dnd" };
  const fakeFetch = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("sends to the international number without +, on the configured route", async () => {
    let seen: { url: string; body: Record<string, string> } | null = null;
    const f = (async (url: string, init?: RequestInit) => {
      seen = { url, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ code: "ok", message_id_str: "123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendSms(cfg, "+2348031234567", "Hello", f);
    expect(r).toEqual({ ok: true, messageId: "123" });
    expect(seen!.url).toBe("https://example.test/api/sms/send");
    expect(seen!.body).toMatchObject({ to: "2348031234567", from: "TapIn", sms: "Hello", type: "plain", channel: "dnd", api_key: "k" });
    expect(termiiNumber("+2348031234567")).toBe("2348031234567");
  });

  it("retries server errors but not bad requests", async () => {
    expect(await sendSms(cfg, "+2348031234567", "x", fakeFetch(500, { message: "down" }))).toMatchObject({ ok: false, retryable: true });
    expect(await sendSms(cfg, "+2348031234567", "x", fakeFetch(429, {}))).toMatchObject({ ok: false, retryable: true });
    expect(await sendSms(cfg, "+2348031234567", "x", fakeFetch(400, { message: "Sender ID not approved" }))).toMatchObject({
      ok: false, retryable: false, error: "Termii 400: Sender ID not approved",
    });
  });

  it("treats a network failure as retryable", async () => {
    const boom = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    expect(await sendSms(cfg, "+2348031234567", "x", boom)).toMatchObject({ ok: false, retryable: true });
  });
});

