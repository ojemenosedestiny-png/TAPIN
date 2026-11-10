/**
 * End-to-end check of POST /api/tap against a real Supabase project (throwaway school, cleaned up).
 *   RUN_RLS_TESTS=1 npm run test:rls
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateDeviceToken, hashDeviceToken } from "@/lib/devices";
import { resetRateLimits } from "@/lib/rate-limit";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
let POST: (req: NextRequest) => Promise<Response>;
let GET_KIOSK: (req: NextRequest) => Promise<Response>;
const ids: Record<string, string> = {};
const token = generateDeviceToken();
const UID = `0A${Date.now().toString(16).toUpperCase().slice(-8)}`.padEnd(10, "0");
const BLOCKED_UID = `0B${Date.now().toString(16).toUpperCase().slice(-8)}`.padEnd(10, "0");

// Yesterday in Lagos, so every test time is in the past but within the 72-hour window.
const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const lagos = (hhmm: string) => new Date(`${yesterday}T${hhmm}:00+01:00`).toISOString();

async function tap(body: Record<string, unknown>, auth = token) {
  const res = await POST(new NextRequest("http://localhost/api/tap", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!enabled)("POST /api/tap", () => {
  beforeAll(async () => {
    ({ POST } = await import("@/app/api/tap/route"));
    ({ GET: GET_KIOSK } = await import("@/app/api/kiosk/route"));
    resetRateLimits();
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data.id as string;
    };
    ids.school = await ins("schools", { name: `tap-test-${Date.now()}`, resumption_time: "07:45", closing_time: "14:00", absence_cutoff_time: "09:00" });
    ids.class = await ins("classes", { school_id: ids.school, name: "JSS2A" });
    ids.student = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "T-1", first_name: "Chioma", last_name: "Okafor" });
    ids.student2 = await ins("students", { school_id: ids.school, class_id: ids.class, admission_no: "T-2", first_name: "David", last_name: "Bello" });
    await ins("cards", { school_id: ids.school, uid: UID, holder_type: "student", holder_id: ids.student });
    await ins("cards", { school_id: ids.school, uid: BLOCKED_UID, holder_type: "student", holder_id: ids.student2, status: "blocked" });
    ids.device = await ins("devices", { school_id: ids.school, name: "Main Gate", token_hash: hashDeviceToken(token) });
  }, 60_000);

  afterAll(async () => {
    if (db && ids.school) await db.from("schools").delete().eq("id", ids.school);
  });

  it("refuses a missing or wrong device token", async () => {
    expect((await tap({ uid: UID }, "nope")).status).toBe(401);
    expect((await tap({ uid: UID }, generateDeviceToken())).status).toBe(401);
  });

  it("kiosk check-in returns only the school name and device, and marks it online", async () => {
    const res = await GET_KIOSK(new NextRequest("http://localhost/api/kiosk", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.device.name).toBe("Main Gate");
    expect(Object.keys(body.school).sort()).toEqual(["logo_url", "name", "timezone"]);
    await new Promise((r) => setTimeout(r, 500));
    const { data } = await db.from("devices").select("last_seen").eq("id", ids.device).single();
    expect(data?.last_seen).not.toBeNull();
  });

  it("unknown card → unknown, and the tap is logged for the admin", async () => {
    const r = await tap({ uid: "DE:AD:BE:EF", tapped_at: lagos("07:30") });
    expect(r.body).toMatchObject({ action: "unknown" });
    expect(r.body.name).toBeUndefined();
    const { data } = await db.from("tap_events").select("result, uid").eq("school_id", ids.school).eq("uid", "DEADBEEF");
    expect(data).toEqual([{ result: "unknown", uid: "DEADBEEF" }]);
  });

  it("blocked card → blocked, nothing recorded as attendance", async () => {
    const r = await tap({ uid: BLOCKED_UID, tapped_at: lagos("07:31") });
    expect(r.body).toMatchObject({ action: "blocked" });
    const { count } = await db.from("attendance").select("id", { count: "exact", head: true }).eq("holder_id", ids.student2);
    expect(count).toBe(0);
  });

  it("first tap signs in on time and returns only name, photo, class, time, greeting", async () => {
    const r = await tap({ uid: UID.match(/../g)!.join(":").toLowerCase(), tapped_at: lagos("07:42"), client_id: "offline-0001" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ action: "signed_in", name: "Chioma Okafor", first_name: "Chioma", class: "JSS2A", late: false, greeting: "Good morning", time: "7:42 AM" });
    const { data } = await db.from("attendance").select("sign_in_at, sign_out_at, device_id").eq("holder_id", ids.student).single();
    expect(new Date(data!.sign_in_at).toISOString()).toBe(lagos("07:42"));
    expect(data!.device_id).toBe(ids.device);
  });

  it("replaying the same offline tap changes nothing", async () => {
    const r = await tap({ uid: UID, tapped_at: lagos("07:42"), client_id: "offline-0001" });
    expect(r.body).toMatchObject({ action: "signed_in", replayed: true });
    const { count } = await db.from("tap_events").select("id", { count: "exact", head: true }).eq("client_id", "offline-0001").eq("device_id", ids.device);
    expect(count).toBe(1);
  });

  it("a tap within 5 minutes is a duplicate", async () => {
    expect((await tap({ uid: UID, tapped_at: lagos("07:45") })).body).toMatchObject({ action: "duplicate", reason: "recent_tap" });
  });

  it("tapping again before closing does not sign out", async () => {
    expect((await tap({ uid: UID, tapped_at: lagos("11:00") })).body).toMatchObject({ action: "duplicate", reason: "already_signed_in" });
  });

  it("a tap after closing time signs out", async () => {
    const r = await tap({ uid: UID, tapped_at: lagos("14:15") });
    expect(r.body).toMatchObject({ action: "signed_out", name: "Chioma Okafor", time: "2:15 PM" });
    const { data } = await db.from("attendance").select("sign_out_at").eq("holder_id", ids.student).single();
    expect(new Date(data!.sign_out_at).toISOString()).toBe(lagos("14:15"));
  });

  it("after signing out, further taps don't change anything", async () => {
    expect((await tap({ uid: UID, tapped_at: lagos("15:30") })).body).toMatchObject({ action: "duplicate", reason: "already_signed_out" });
  });

  it("an early release lets a tap before closing sign out, once, and records why", async () => {
    const uid = `0E${Date.now().toString(16).toUpperCase().slice(-8)}`;
    const { data: st } = await db.from("students").insert({ school_id: ids.school, class_id: ids.class, admission_no: "T-3", first_name: "Amaka", last_name: "Eze" }).select("id").single();
    await db.from("cards").insert({ school_id: ids.school, uid, holder_type: "student", holder_id: st!.id });
    expect((await tap({ uid, tapped_at: lagos("07:30") })).body).toMatchObject({ action: "signed_in" });
    // Without a release, a 10:00 tap doesn't sign out.
    expect((await tap({ uid, tapped_at: lagos("10:00") })).body).toMatchObject({ action: "duplicate", reason: "already_signed_in" });
    await db.from("early_releases").insert({ school_id: ids.school, holder_type: "student", holder_id: st!.id, date: yesterday, reason: "Sick" });
    const r = await tap({ uid, tapped_at: lagos("10:30") });
    expect(r.body).toMatchObject({ action: "signed_out", early: true });
    const { data: row } = await db.from("attendance").select("sign_out_at, early_release").eq("holder_id", st!.id).single();
    expect(row).toMatchObject({ early_release: true });
    const { data: rel } = await db.from("early_releases").select("used_at").eq("holder_id", st!.id).single();
    expect(rel?.used_at).not.toBeNull();
  });

  it("rejects future and very old tap times", async () => {
    expect((await tap({ uid: UID, tapped_at: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(400);
    expect((await tap({ uid: UID, tapped_at: new Date(Date.now() - 5 * 24 * 3600_000).toISOString() })).status).toBe(400);
  });

  it("a revoked kiosk is refused immediately", async () => {
    await db.from("devices").update({ revoked_at: new Date().toISOString() }).eq("id", ids.device);
    expect((await tap({ uid: UID })).status).toBe(403);
  });
});
