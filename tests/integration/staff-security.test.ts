/**
 * Staff check-in security against a real Supabase project (throwaway school, cleaned up).
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/staff-security.test.ts
 * Card + PIN, wrong-PIN lockout with a notice, the kiosk photo, the hours window, and PINs hidden from browsers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateDeviceToken, hashDeviceToken } from "@/lib/devices";
import { resetRateLimits } from "@/lib/rate-limit";
import { hashPin } from "@/lib/emergency";
import { PHOTO_BUCKET } from "@/lib/photos";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
type Handler = (req: NextRequest) => Promise<Response>;
let TAP: Handler;
const ids: Record<string, string> = {};
const token = generateDeviceToken();
const stamp = Date.now().toString(16).toUpperCase().slice(-8);
const CARD = `5A${stamp}`, CARD2 = `5B${stamp}`;
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]).toString("base64")}`;
let n = 0;

async function tap(body: Record<string, unknown>) {
  const res = await TAP(new NextRequest("http://localhost/api/tap", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tapped_at: new Date().toISOString(), client_id: `staffsec-${stamp}-${++n}`, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!enabled)("staff check-in security", () => {
  beforeAll(async () => {
    ({ POST: TAP } = await import("@/app/api/tap/route"));
    resetRateLimits();
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data?.id as string;
    };
    ids.school = await ins("schools", {
      name: `staffsec-test-${Date.now()}`, resumption_time: "00:00", closing_time: "23:59", absence_cutoff_time: "23:58",
      staff_pin_required: true, staff_photo: true, staff_alerts: true,
    });
    ids.ada = await ins("staff", { school_id: ids.school, name: "Ada Teacher" });
    ids.bayo = await ins("staff", { school_id: ids.school, name: "Bayo NoPin" });
    await ins("cards", { school_id: ids.school, uid: CARD, holder_type: "staff", holder_id: ids.ada });
    await ins("cards", { school_id: ids.school, uid: CARD2, holder_type: "staff", holder_id: ids.bayo });
    ids.device = await ins("devices", { school_id: ids.school, name: "Gate", token_hash: hashDeviceToken(token) });
    await db.from("staff_pins").insert({ staff_id: ids.ada, school_id: ids.school, pin_hash: hashPin("4829") });
  }, 90_000);

  afterAll(async () => {
    if (!db || !ids.school) return;
    const { data: taps } = await db.from("tap_events").select("photo_path").eq("school_id", ids.school).not("photo_path", "is", null);
    const paths = (taps ?? []).map((t) => t.photo_path as string);
    if (paths.length) await db.storage.from(PHOTO_BUCKET).remove(paths);
    await db.from("schools").delete().eq("id", ids.school);
  }, 90_000);

  it("a staff tap asks for the PIN and a photo, and records nothing yet", async () => {
    const r = await tap({ uid: CARD });
    expect(r.body).toMatchObject({ action: "staff_check", needs_pin: true, needs_photo: true, first_name: "Ada" });
    const { count } = await db.from("attendance").select("id", { count: "exact", head: true }).eq("holder_id", ids.ada!);
    expect(count).toBe(0);
  });

  it("the right PIN checks in, with the kiosk photo kept", async () => {
    const r = await tap({ uid: CARD, pin: "4829", photo: JPEG });
    expect(r.body.action).toBe("signed_in");
    const { data: t } = await db.from("tap_events").select("pin_checked, photo_path").eq("holder_id", ids.ada!).eq("result", "signed_in").single();
    expect(t!.pin_checked).toBe(true);
    expect(t!.photo_path).toMatch(new RegExp(`^${ids.school}/staff-taps/\\d{4}-\\d{2}-\\d{2}/${ids.ada}-\\d+\\.jpg$`));
    const { data: file } = await db.storage.from(PHOTO_BUCKET).download(t!.photo_path!);
    expect(file?.size).toBeGreaterThan(0);
  });

  it("wrong PINs count down, then lock the person and tell the admin", async () => {
    for (let i = 4; i >= 1; i--) {
      const r = await tap({ uid: CARD, pin: "0000", photo: "" });
      expect(r.body).toMatchObject({ action: "staff_check", needs_pin: true });
      expect(r.body.notice).toContain(`${i} ${i === 1 ? "try" : "tries"} left`);
    }
    const locked = await tap({ uid: CARD, pin: "0000", photo: "" });
    expect(locked.body.action).toBe("staff_refused");
    expect(locked.body.reason).toMatch(/Locked for 15 minutes/);
    // Even the right PIN is refused while locked.
    expect((await tap({ uid: CARD, pin: "4829", photo: "" })).body.action).toBe("staff_refused");
    const { data: note } = await db.from("notifications").select("message").eq("school_id", ids.school!).eq("kind", "staff_pin").single();
    expect(note!.message).toContain("Ada Teacher: 5 wrong PINs");
  });

  it("staff without a PIN yet are let through, marked no PIN", async () => {
    const ask = await tap({ uid: CARD2 });
    expect(ask.body).toMatchObject({ action: "staff_check", needs_pin: false, needs_photo: true }); // no keypad: only the photo
    const r = await tap({ uid: CARD2, photo: "" });
    expect(r.body.action).toBe("signed_in");
    const { data: t } = await db.from("tap_events").select("pin_checked, photo_path").eq("holder_id", ids.bayo!).eq("result", "signed_in").single();
    expect(t).toEqual({ pin_checked: false, photo_path: null });
  });

  it("outside the staff hours, nobody checks in", async () => {
    // A window that has certainly closed: one minute long, twelve hours from now.
    const later = new Date(Date.now() + 12 * 3600_000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Lagos" });
    await db.from("schools").update({ staff_from: later, staff_until: later }).eq("id", ids.school!);
    const r = await tap({ uid: CARD2 });
    expect(r.body.action).toBe("staff_refused");
    expect(r.body.reason).toMatch(/Staff check-in is open/);
    await db.from("schools").update({ staff_from: null, staff_until: null }).eq("id", ids.school!);
  });

  it("PINs are never readable from a browser", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    expect((await anon.from("staff_pins").select("pin_hash")).data ?? []).toEqual([]);
  });
});
