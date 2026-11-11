/**
 * Teacher lesson check against a real Supabase project (throwaway school, cleaned up).
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/lessons.test.ts
 * Director alerts stay off here so no real SMS is ever sent; their wording is unit tested.
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
let TAP: (req: NextRequest) => Promise<Response>;
let LESSON: (req: NextRequest) => Promise<Response>;
const ids: Record<string, string> = {};
const token = generateDeviceToken();
const otherToken = generateDeviceToken();
const UID = `0C${Date.now().toString(16).toUpperCase().slice(-8)}`.padEnd(10, "0");
const t0 = Date.now();
const at = (offsetSec: number) => new Date(t0 + offsetSec * 1000).toISOString();

async function call(handler: (req: NextRequest) => Promise<Response>, path: string, body: Record<string, unknown>, auth = token) {
  const res = await handler(new NextRequest(`http://localhost${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}
const tap = (offsetSec: number) => call(TAP, "/api/tap", { uid: UID, tapped_at: at(offsetSec) });

describe.skipIf(!enabled)("teacher lessons at the kiosk", () => {
  beforeAll(async () => {
    ({ POST: TAP } = await import("@/app/api/tap/route"));
    ({ POST: LESSON } = await import("@/app/api/lesson/route"));
    resetRateLimits();
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const ins = async (t: string, row: Record<string, unknown>) => {
      const { data, error } = await db.from(t).insert(row).select("id").single();
      if (error) throw new Error(`${t}: ${error.message}`);
      return data?.id as string;
    };
    ids.school = await ins("schools", { name: `lesson-test-${t0}`, resumption_time: "00:00", closing_time: "23:59", absence_cutoff_time: "23:58" });
    ids.class = await ins("classes", { school_id: ids.school, name: "JSS2A" });
    ids.subject = await ins("subjects", { school_id: ids.school, name: "Mathematics" });
    ids.staff = await ins("staff", { school_id: ids.school, name: "Ada Obi" });
    await ins("teacher_assignments", { school_id: ids.school, staff_id: ids.staff, class_id: ids.class, subject_id: ids.subject });
    await ins("cards", { school_id: ids.school, uid: UID, holder_type: "staff", holder_id: ids.staff });
    ids.device = await ins("devices", { school_id: ids.school, name: "Staff Room", token_hash: hashDeviceToken(token) });
    ids.device2 = await ins("devices", { school_id: ids.school, name: "Gate", token_hash: hashDeviceToken(otherToken) });
    const { error } = await db.from("lesson_settings").insert({ school_id: ids.school, enabled: true, min_minutes: 20, max_minutes: 90, autoclose_time: "23:59", director_alerts: "off" });
    if (error) throw new Error(error.message);
  }, 60_000);

  afterAll(async () => {
    if (db && ids.school) await db.from("schools").delete().eq("id", ids.school);
  });

  let menuTap = 0;

  it("first tap of the day signs the teacher in", async () => {
    const r = await tap(-300);
    expect(r.body).toMatchObject({ action: "signed_in", name: "Ada Obi" });
  });

  it("the next tap offers Start lesson / Sign out with the teacher's own classes first", async () => {
    const r = await tap(0);
    expect(r.body.action).toBe("menu");
    expect(r.body.tap_id).toBeGreaterThan(0);
    expect(r.body.options.assignments).toEqual([{ class_id: ids.class, class_name: "JSS2A", subject_id: ids.subject, subject_name: "Mathematics" }]);
    menuTap = r.body.tap_id;
  });

  it("a choice from another kiosk, or for a made-up tap, is refused", async () => {
    expect((await call(LESSON, "/api/lesson", { choice: "start", tap_id: menuTap, class_id: ids.class, subject_id: ids.subject }, otherToken)).status).toBe(409);
    expect((await call(LESSON, "/api/lesson", { choice: "start", tap_id: menuTap + 999_999, class_id: ids.class, subject_id: ids.subject })).status).toBe(409);
  });

  it("starts the lesson, and sending the same choice twice doesn't start two", async () => {
    const body = { choice: "start", tap_id: menuTap, class_id: ids.class, subject_id: ids.subject };
    const r = await call(LESSON, "/api/lesson", body);
    expect(r.body).toMatchObject({ action: "lesson_started", class: "JSS2A", subject: "Mathematics" });
    expect((await call(LESSON, "/api/lesson", body)).body.action).toBe("lesson_started");
    const { data } = await db.from("lessons").select("status").eq("staff_id", ids.staff);
    expect(data).toEqual([{ status: "open" }]);
  });

  it("a second tap within 10 seconds is ignored", async () => {
    expect((await tap(5)).body).toMatchObject({ action: "duplicate" });
    const { data } = await db.from("lessons").select("status").eq("staff_id", ids.staff).single();
    expect(data?.status).toBe("open");
  });

  it("the next tap ends the lesson, records the length and flags it as too short", async () => {
    const r = await tap(65);
    expect(r.body).toMatchObject({ action: "lesson_ended", class: "JSS2A", subject: "Mathematics", flags: ["too_short"] });
    const { data } = await db.from("lessons").select("status, flags, duration_minutes, end_device_id").eq("staff_id", ids.staff).single();
    expect(data).toMatchObject({ status: "closed", flags: ["too_short"], end_device_id: ids.device });
    expect(data?.duration_minutes).toBeGreaterThanOrEqual(0);
  });

  it("Sign out from the menu signs the teacher out", async () => {
    const m = await tap(90);
    expect(m.body.action).toBe("menu");
    const r = await call(LESSON, "/api/lesson", { choice: "sign_out", tap_id: m.body.tap_id });
    expect(r.body).toMatchObject({ action: "signed_out", name: "Ada Obi" });
    const { data } = await db.from("attendance").select("sign_out_at").eq("holder_id", ids.staff).single();
    expect(data?.sign_out_at).not.toBeNull();
  });

  it("auto-close ends a lesson left open from an earlier day and flags it", async () => {
    const yesterday = new Date(t0 - 24 * 3600 * 1000).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
    const { data: l, error } = await db.from("lessons").insert({
      school_id: ids.school, staff_id: ids.staff, class_id: ids.class, subject_id: ids.subject, class_name: "JSS2A", subject_name: "Mathematics",
      date: yesterday, started_at: new Date(`${yesterday}T09:00:00+01:00`).toISOString(),
    }).select("id").single();
    expect(error).toBeNull();
    const { error: rpcErr } = await db.rpc("auto_close_lessons", { p_school: ids.school });
    expect(rpcErr).toBeNull();
    const { data } = await db.from("lessons").select("status, flags, ended_at, duration_minutes").eq("id", l!.id).single();
    expect(data?.status).toBe("auto_closed");
    expect(data?.flags).toEqual(["too_long", "auto_closed"]); // 09:00 to the 23:59 auto-close
    expect(data?.duration_minutes).toBe(899);
  });

  it("a school with lessons off keeps the old behaviour (no menu)", async () => {
    await db.from("lesson_settings").update({ enabled: false }).eq("school_id", ids.school);
    const r = await tap(120);
    expect(["duplicate", "signed_out"]).toContain(r.body.action);
  });
});
